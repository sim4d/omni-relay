import type { NormalizedEvent } from '../../core/stream-events'
import { iterableToSSEStream, type SSEMessage } from '../../lib/sse'

function finishReasonFromEvent(event: Extract<NormalizedEvent, { type: 'response_end' }>): string {
  if (event.finishReason === 'tool_call' || event.finishReason === 'tool_calls') return 'tool_calls'
  return event.finishReason ?? 'stop'
}

async function* toOpenAIChatSSE(events: AsyncIterable<NormalizedEvent>): AsyncGenerator<SSEMessage> {
  let model = 'unknown'
  let id = `chatcmpl_${crypto.randomUUID().replace(/-/g, '')}`
  const created = Math.floor(Date.now() / 1000)
  const toolIndices = new Map<string, number>()
  let nextToolIndex = 0

  for await (const event of events) {
    if (event.type === 'response_start') {
      model = event.model
      continue
    }

    if (event.type === 'message_start') {
      yield {
        data: JSON.stringify({
          id,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
        }),
      }
      continue
    }

    if (event.type === 'content_delta') {
      yield {
        data: JSON.stringify({
          id,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [{ index: 0, delta: { content: event.text }, finish_reason: null }],
        }),
      }
      continue
    }

    if (event.type === 'tool_call_start') {
      const index = nextToolIndex++
      toolIndices.set(event.id, index)
      yield {
        data: JSON.stringify({
          id,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [{
            index: 0,
            delta: {
              tool_calls: [{
                index,
                id: event.id,
                type: 'function',
                function: { name: event.name, arguments: '' },
              }],
            },
            finish_reason: null,
          }],
        }),
      }
      continue
    }

    if (event.type === 'tool_call_delta') {
      const index = toolIndices.get(event.id) ?? 0
      yield {
        data: JSON.stringify({
          id,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [{
            index: 0,
            delta: {
              tool_calls: [{
                index,
                function: { arguments: event.argumentsDelta },
              }],
            },
            finish_reason: null,
          }],
        }),
      }
      continue
    }

    if (event.type === 'response_end') {
      yield {
        data: JSON.stringify({
          id,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [{ index: 0, delta: {}, finish_reason: finishReasonFromEvent(event) }],
        }),
      }
      yield { data: '[DONE]' }
      return
    }
  }
}

export function renderOpenAIChatStream(events: AsyncIterable<NormalizedEvent>): ReadableStream<Uint8Array> {
  return iterableToSSEStream(toOpenAIChatSSE(events))
}
