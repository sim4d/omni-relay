import type { NormalizedEvent } from '../../core/stream-events'
import { UpstreamAPIError } from '../../errors'
import { parseSSEStream } from '../../lib/sse'

export async function* mapOpenAIResponsesStreamToEvents(stream: ReadableStream<Uint8Array>): AsyncGenerator<NormalizedEvent> {
  let started = false
  let model = 'unknown'
  const toolCalls = new Map<string, { id: string; name: string; toolType?: 'function' | 'custom'; callId?: string }>()

  for await (const event of parseSSEStream(stream)) {
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(event.data) as Record<string, unknown>
    } catch {
      throw new UpstreamAPIError('OpenAI Responses streaming chunk was not valid JSON', { chunk: event.data, event: event.event })
    }

    const eventType = event.event ?? (typeof payload.type === 'string' ? payload.type : undefined)
    if (!eventType) continue

    if (eventType === 'response.created') {
      const response = payload.response && typeof payload.response === 'object' ? payload.response as Record<string, unknown> : payload
      model = typeof response.model === 'string' ? response.model : model
      if (!started) {
        yield { type: 'response_start', provider: 'openai', model }
        yield { type: 'message_start', role: 'assistant' }
        started = true
      }
      continue
    }

    if (eventType === 'response.output_text.delta' && typeof payload.delta === 'string') {
      if (!started) {
        yield { type: 'response_start', provider: 'openai', model }
        yield { type: 'message_start', role: 'assistant' }
        started = true
      }
      yield { type: 'content_delta', deltaType: 'text', text: payload.delta }
      continue
    }

    if (eventType === 'response.output_item.added') {
      const item = payload.item && typeof payload.item === 'object' ? payload.item as Record<string, unknown> : undefined
      if (item?.type === 'function_call' && typeof item.name === 'string') {
        const id = typeof item.call_id === 'string' ? item.call_id : typeof item.id === 'string' ? item.id : crypto.randomUUID()
        toolCalls.set(id, { id, name: item.name, toolType: 'function', callId: typeof item.call_id === 'string' ? item.call_id : id })
        if (!started) {
          yield { type: 'response_start', provider: 'openai', model }
          yield { type: 'message_start', role: 'assistant' }
          started = true
        }
        yield { type: 'tool_call_start', id, name: item.name }
        continue
      }

      if (item?.type === 'custom_tool_call' && typeof item.name === 'string') {
        const id = typeof item.id === 'string' ? item.id : typeof item.call_id === 'string' ? item.call_id : crypto.randomUUID()
        const callId = typeof item.call_id === 'string' ? item.call_id : id
        toolCalls.set(id, { id, name: item.name, toolType: 'custom', callId })
        if (!started) {
          yield { type: 'response_start', provider: 'openai', model }
          yield { type: 'message_start', role: 'assistant' }
          started = true
        }
        yield { type: 'tool_call_start', id, callId, name: item.name, toolType: 'custom' }
      }
      continue
    }

    if (eventType === 'response.function_call_arguments.delta') {
      const id = typeof payload.call_id === 'string'
        ? payload.call_id
        : typeof payload.item_id === 'string'
          ? payload.item_id
          : undefined
      if (id && typeof payload.delta === 'string') {
        yield { type: 'tool_call_delta', id, argumentsDelta: payload.delta }
      }
      continue
    }

    if (eventType === 'response.custom_tool_call_input.delta') {
      const id = typeof payload.item_id === 'string' ? payload.item_id : undefined
      if (id && typeof payload.delta === 'string') {
        yield { type: 'tool_call_delta', id, argumentsDelta: payload.delta }
      }
      continue
    }

    if (eventType === 'response.custom_tool_call_input.done') {
      const id = typeof payload.item_id === 'string' ? payload.item_id : undefined
      if (id && toolCalls.has(id)) {
        yield { type: 'tool_call_end', id }
        toolCalls.delete(id)
      }
      continue
    }

    if (eventType === 'response.output_item.done' || eventType === 'response.function_call_arguments.done') {
      const item = payload.item && typeof payload.item === 'object' ? payload.item as Record<string, unknown> : payload
      const id =
        typeof item.id === 'string'
          ? item.id
          : typeof item.call_id === 'string'
            ? item.call_id
            : undefined
      if (id && toolCalls.has(id)) {
        yield { type: 'tool_call_end', id }
        toolCalls.delete(id)
      }
      continue
    }

    if (eventType === 'response.completed') {
      const response = payload.response && typeof payload.response === 'object' ? payload.response as Record<string, unknown> : payload
      const usage = response.usage && typeof response.usage === 'object' ? response.usage as Record<string, unknown> : undefined
      if (usage) {
        yield {
          type: 'usage',
          usage: {
            inputTokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : undefined,
            outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined,
            totalTokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : undefined,
          },
        }
      }
      for (const [, tool] of toolCalls) {
        yield { type: 'tool_call_end', id: tool.id }
      }
      yield { type: 'response_end', finishReason: toolCalls.size > 0 ? 'tool_calls' : 'stop' }
      return
    }
  }
}
