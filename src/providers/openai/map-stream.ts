import type { NormalizedEvent } from '../../core/stream-events'
import { readNestedNumber } from '../../core/usage'
import { UpstreamAPIError } from '../../errors'
import { parseSSEStream } from '../../lib/sse'

export async function* mapOpenAIChatStreamToEvents(stream: ReadableStream<Uint8Array>): AsyncGenerator<NormalizedEvent> {
  let started = false
  let activeModel = 'unknown'
  let finishReason: string | undefined
  const toolCalls = new Map<number, { id: string; name: string }>()

  for await (const event of parseSSEStream(stream)) {
    if (event.data === '[DONE]') {
      for (const [, tool] of toolCalls) {
        yield { type: 'tool_call_end', id: tool.id }
      }
      yield { type: 'response_end', finishReason: finishReason ?? (toolCalls.size > 0 ? 'tool_calls' : 'stop') }
      return
    }

    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(event.data) as Record<string, unknown>
    } catch {
      throw new UpstreamAPIError('OpenAI streaming chunk was not valid JSON', { chunk: event.data })
    }

    const model = typeof payload.model === 'string' ? payload.model : activeModel
    activeModel = model

    if (!started) {
      yield { type: 'response_start', provider: 'openai', model }
      yield { type: 'message_start', role: 'assistant' }
      started = true
    }

    const choices = Array.isArray(payload.choices) ? payload.choices : []
    const firstChoice = choices[0]
    if (firstChoice && typeof firstChoice === 'object') {
      const choice = firstChoice as Record<string, unknown>
      const delta = choice.delta && typeof choice.delta === 'object' ? choice.delta as Record<string, unknown> : undefined

      if (delta && typeof delta.content === 'string' && delta.content.length > 0) {
        yield { type: 'content_delta', deltaType: 'text', text: delta.content }
      }

      // Reasoning content deltas (OpenAI reasoning models / some proxies).
      const reasoning = delta && (typeof delta.reasoning === 'string' ? delta.reasoning : typeof delta.reasoning_content === 'string' ? delta.reasoning_content : undefined)
      if (reasoning && reasoning.length > 0) {
        yield { type: 'reasoning_delta', text: reasoning }
      }

      if (delta && Array.isArray(delta.tool_calls)) {
        for (const item of delta.tool_calls) {
          if (!item || typeof item !== 'object') continue
          const record = item as Record<string, unknown>
          const index = typeof record.index === 'number' ? record.index : toolCalls.size
          const fn = record.function && typeof record.function === 'object' ? record.function as Record<string, unknown> : undefined
          const existing = toolCalls.get(index)
          const id = typeof record.id === 'string' ? record.id : existing?.id ?? crypto.randomUUID()
          const name = fn && typeof fn.name === 'string' ? fn.name : existing?.name ?? 'function'

          if (!existing) {
            toolCalls.set(index, { id, name })
            yield { type: 'tool_call_start', id, name }
          }

          if (fn && typeof fn.arguments === 'string' && fn.arguments.length > 0) {
            yield { type: 'tool_call_delta', id, argumentsDelta: fn.arguments }
          }
        }
      }

      // A chunk may carry usage (either inline with finish_reason, or as a
      // separate terminal usage-only chunk when stream_options.include_usage
      // is set). Extract it BEFORE the finish_reason branch below, because
      // finish_reason does NOT terminate the upstream stream — the usage-only
      // chunk (or [DONE]) comes after it. Emitting response_end on
      // finish_reason would drop the subsequent usage chunk.
      const inlineUsage = payload.usage && typeof payload.usage === 'object' ? payload.usage as Record<string, unknown> : undefined
      if (inlineUsage) {
        yield { type: 'usage', usage: extractUsage(inlineUsage) }
      }

      if (typeof choice.finish_reason === 'string' && choice.finish_reason.length > 0) {
        finishReason = choice.finish_reason
        // Do NOT return here: with include_usage the upstream sends a
        // usage-only chunk AFTER finish_reason. Defer response_end to the
        // [DONE] sentinel / stream end so that chunk is consumed.
      }
    } else {
      // choices is empty — this is the terminal usage-only chunk. Extract it.
      const terminalUsage = payload.usage && typeof payload.usage === 'object' ? payload.usage as Record<string, unknown> : undefined
      if (terminalUsage) {
        yield { type: 'usage', usage: extractUsage(terminalUsage) }
      }
    }
  }

  // Stream ended without a [DONE] sentinel. Close any open tool calls and
  // emit the deferred response_end using the captured finish_reason.
  for (const [, tool] of toolCalls) {
    yield { type: 'tool_call_end', id: tool.id }
  }
  yield { type: 'response_end', finishReason: finishReason ?? (toolCalls.size > 0 ? 'tool_calls' : 'stop') }
}

function extractUsage(usage: Record<string, unknown>) {
  return {
    inputTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : undefined,
    outputTokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : undefined,
    totalTokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : undefined,
    cacheReadInputTokens: readNestedNumber(usage, ['prompt_tokens_details', 'cached_tokens']),
    reasoningTokens: readNestedNumber(usage, ['completion_tokens_details', 'reasoning_tokens']),
  }
}
