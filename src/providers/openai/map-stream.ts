import type { NormalizedEvent } from '../../core/stream-events'
import { UpstreamAPIError } from '../../errors'
import { parseSSEStream } from '../../lib/sse'

export async function* mapOpenAIChatStreamToEvents(stream: ReadableStream<Uint8Array>): AsyncGenerator<NormalizedEvent> {
  let started = false
  let activeModel = 'unknown'
  const toolCalls = new Map<number, { id: string; name: string }>()

  for await (const event of parseSSEStream(stream)) {
    if (event.data === '[DONE]') {
      for (const [, tool] of toolCalls) {
        yield { type: 'tool_call_end', id: tool.id }
      }
      yield { type: 'response_end', finishReason: toolCalls.size > 0 ? 'tool_calls' : 'stop' }
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
    if (!firstChoice || typeof firstChoice !== 'object') {
      continue
    }

    const choice = firstChoice as Record<string, unknown>
    const delta = choice.delta && typeof choice.delta === 'object' ? choice.delta as Record<string, unknown> : undefined

    if (delta && typeof delta.content === 'string' && delta.content.length > 0) {
      yield { type: 'content_delta', deltaType: 'text', text: delta.content }
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

    if (typeof choice.finish_reason === 'string' && choice.finish_reason.length > 0) {
      for (const [, tool] of toolCalls) {
        yield { type: 'tool_call_end', id: tool.id }
      }
      yield { type: 'response_end', finishReason: choice.finish_reason }
      return
    }
  }
}
