import type { NormalizedEvent } from '../../core/stream-events'
import { UpstreamAPIError } from '../../errors'
import { parseSSEStream } from '../../lib/sse'

export async function* mapAnthropicStreamToEvents(stream: ReadableStream<Uint8Array>): AsyncGenerator<NormalizedEvent> {
  let model = 'unknown'
  const toolBlocks = new Map<number, { id: string; name: string }>()
  let started = false
  let finishReason: string | undefined

  for await (const event of parseSSEStream(stream)) {
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(event.data) as Record<string, unknown>
    } catch {
      throw new UpstreamAPIError('Anthropic streaming chunk was not valid JSON', { chunk: event.data, event: event.event })
    }

    const eventType = event.event ?? (typeof payload.type === 'string' ? payload.type : undefined)
    if (!eventType || eventType === 'ping') continue

    if (eventType === 'message_start') {
      const message = payload.message && typeof payload.message === 'object' ? payload.message as Record<string, unknown> : payload
      model = typeof message.model === 'string' ? message.model : model
      yield { type: 'response_start', provider: 'anthropic', model }
      started = true
      // message_start may carry input usage incl. cache tokens. Emit usage
      // BEFORE message_start so the egress renderer can include the real
      // input/cache token counts in the SSE message_start frame.
      const usage = message.usage && typeof message.usage === 'object' ? message.usage as Record<string, unknown> : undefined
      if (usage) {
        yield {
          type: 'usage',
          usage: {
            inputTokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : undefined,
            outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined,
            cacheCreationInputTokens: typeof usage.cache_creation_input_tokens === 'number' ? usage.cache_creation_input_tokens : undefined,
            cacheReadInputTokens: typeof usage.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : undefined,
          },
        }
      }
      yield { type: 'message_start', role: 'assistant' }
      continue
    }

    if (eventType === 'content_block_start') {
      const block = payload.content_block && typeof payload.content_block === 'object' ? payload.content_block as Record<string, unknown> : undefined
      const index = typeof payload.index === 'number' ? payload.index : toolBlocks.size
      if (block?.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
        toolBlocks.set(index, { id: block.id, name: block.name })
        if (!started) {
          yield { type: 'response_start', provider: 'anthropic', model }
          yield { type: 'message_start', role: 'assistant' }
          started = true
        }
        yield { type: 'tool_call_start', id: block.id, name: block.name }
      }
      // thinking blocks start with no payload; deltas carry the text.
      continue
    }

    if (eventType === 'content_block_delta') {
      const delta = payload.delta && typeof payload.delta === 'object' ? payload.delta as Record<string, unknown> : undefined
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        if (!started) {
          yield { type: 'response_start', provider: 'anthropic', model }
          yield { type: 'message_start', role: 'assistant' }
          started = true
        }
        yield { type: 'content_delta', deltaType: 'text', text: delta.text }
      }

      if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
        if (!started) {
          yield { type: 'response_start', provider: 'anthropic', model }
          yield { type: 'message_start', role: 'assistant' }
          started = true
        }
        yield { type: 'reasoning_delta', text: delta.thinking }
      }

      if (delta?.type === 'signature_delta' && typeof delta.signature === 'string') {
        // Attach to the in-flight reasoning stream. We surface the signature
        // delta so renderers that need it (Anthropic egress) can echo it.
        yield { type: 'reasoning_delta', text: '', signatureDelta: delta.signature }
      }

      if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
        const index = typeof payload.index === 'number' ? payload.index : undefined
        const tool = index !== undefined ? toolBlocks.get(index) : undefined
        if (tool) {
          yield { type: 'tool_call_delta', id: tool.id, argumentsDelta: delta.partial_json }
        }
      }
      continue
    }

    if (eventType === 'content_block_stop') {
      const index = typeof payload.index === 'number' ? payload.index : undefined
      const tool = index !== undefined ? toolBlocks.get(index) : undefined
      if (tool && index !== undefined) {
        yield { type: 'tool_call_end', id: tool.id }
        toolBlocks.delete(index)
      }
      continue
    }

    if (eventType === 'message_delta') {
      const delta = payload.delta && typeof payload.delta === 'object' ? payload.delta as Record<string, unknown> : undefined
      const usage = payload.usage && typeof payload.usage === 'object' ? payload.usage as Record<string, unknown> : undefined
      if (typeof delta?.stop_reason === 'string') {
        finishReason = delta.stop_reason
      }
      if (usage) {
        yield {
          type: 'usage',
          usage: {
            inputTokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : undefined,
            outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined,
            totalTokens:
              typeof usage.input_tokens === 'number' && typeof usage.output_tokens === 'number'
                ? usage.input_tokens + usage.output_tokens
                : undefined,
            cacheCreationInputTokens: typeof usage.cache_creation_input_tokens === 'number' ? usage.cache_creation_input_tokens : undefined,
            cacheReadInputTokens: typeof usage.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : undefined,
          },
        }
      }
      continue
    }

    if (eventType === 'message_stop') {
      for (const [, tool] of toolBlocks) {
        yield { type: 'tool_call_end', id: tool.id }
      }
      yield { type: 'response_end', finishReason: finishReason ?? (toolBlocks.size > 0 ? 'tool_calls' : 'stop') }
      return
    }
  }
}
