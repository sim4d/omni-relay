import type { NormalizedEvent } from '../../core/stream-events'
import { iterableToSSEStream, type SSEMessage } from '../../lib/sse'

async function* toOpenAIResponsesSSE(events: AsyncIterable<NormalizedEvent>): AsyncGenerator<SSEMessage> {
  let id = `resp_${crypto.randomUUID().replace(/-/g, '')}`
  let model = 'unknown'
  let outputIndex = 0
  const toolIndices = new Map<string, number>()
  let sawToolCall = false

  for await (const event of events) {
    if (event.type === 'response_start') {
      model = event.model
      yield {
        event: 'response.created',
        data: JSON.stringify({
          type: 'response.created',
          response: {
            id,
            object: 'response',
            status: 'in_progress',
            model,
          },
        }),
      }
      continue
    }

    if (event.type === 'content_delta') {
      yield {
        event: 'response.output_text.delta',
        data: JSON.stringify({
          type: 'response.output_text.delta',
          response_id: id,
          delta: event.text,
        }),
      }
      continue
    }

    if (event.type === 'tool_call_start') {
      sawToolCall = true
      const currentIndex = outputIndex++
      toolIndices.set(event.id, currentIndex)
      yield {
        event: 'response.output_item.added',
        data: JSON.stringify({
          type: 'response.output_item.added',
          response_id: id,
          output_index: currentIndex,
          item: {
            type: 'function_call',
            id: event.id,
            call_id: event.id,
            name: event.name,
            arguments: '',
          },
        }),
      }
      continue
    }

    if (event.type === 'tool_call_delta') {
      yield {
        event: 'response.function_call_arguments.delta',
        data: JSON.stringify({
          type: 'response.function_call_arguments.delta',
          response_id: id,
          item_id: event.id,
          call_id: event.id,
          delta: event.argumentsDelta,
        }),
      }
      continue
    }

    if (event.type === 'tool_call_end') {
      const currentIndex = toolIndices.get(event.id) ?? 0
      yield {
        event: 'response.output_item.done',
        data: JSON.stringify({
          type: 'response.output_item.done',
          response_id: id,
          output_index: currentIndex,
          item: {
            type: 'function_call',
            id: event.id,
            call_id: event.id,
          },
        }),
      }
      continue
    }

    if (event.type === 'response_end') {
      yield {
        event: 'response.completed',
        data: JSON.stringify({
          type: 'response.completed',
          response: {
            id,
            object: 'response',
            status: 'completed',
            model,
            finish_reason: sawToolCall ? 'tool_calls' : event.finishReason ?? 'stop',
          },
        }),
      }
      return
    }
  }
}

export function renderOpenAIResponsesStream(events: AsyncIterable<NormalizedEvent>): ReadableStream<Uint8Array> {
  return iterableToSSEStream(toOpenAIResponsesSSE(events))
}
