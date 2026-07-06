import type { NormalizedEvent } from '../../core/stream-events'
import { iterableToSSEStream, type SSEMessage } from '../../lib/sse'

async function* toOpenAIResponsesSSE(events: AsyncIterable<NormalizedEvent>): AsyncGenerator<SSEMessage> {
  let id = `resp_${crypto.randomUUID().replace(/-/g, '')}`
  let model = 'unknown'
  let outputIndex = 0
  const toolIndices = new Map<string, { outputIndex: number; toolType?: 'function' | 'custom'; callId: string; input: string; name: string }>()
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
      const toolType = event.toolType === 'custom' ? 'custom' : 'function'
      const callId = event.callId ?? event.id
      toolIndices.set(event.id, { outputIndex: currentIndex, toolType, callId, input: '', name: event.name })
      yield {
        event: 'response.output_item.added',
        data: JSON.stringify({
          type: 'response.output_item.added',
          response_id: id,
          output_index: currentIndex,
          item:
            toolType === 'custom'
              ? {
                  type: 'custom_tool_call',
                  id: event.id,
                  call_id: callId,
                  name: event.name,
                  input: '',
                }
              : {
                  type: 'function_call',
                  id: event.id,
                  call_id: callId,
                  name: event.name,
                  arguments: '',
                },
        }),
      }
      continue
    }

    if (event.type === 'tool_call_delta') {
      const toolMeta = toolIndices.get(event.id)
      if (toolMeta?.toolType === 'custom') {
        toolMeta.input += event.argumentsDelta
        yield {
          event: 'response.custom_tool_call_input.delta',
          data: JSON.stringify({
            type: 'response.custom_tool_call_input.delta',
            response_id: id,
            output_index: toolMeta.outputIndex,
            item_id: event.id,
            delta: event.argumentsDelta,
          }),
        }
        continue
      }

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
      const toolMeta = toolIndices.get(event.id)
      const currentIndex = toolMeta?.outputIndex ?? 0
      if (toolMeta?.toolType === 'custom') {
        yield {
          event: 'response.custom_tool_call_input.done',
          data: JSON.stringify({
            type: 'response.custom_tool_call_input.done',
            response_id: id,
            output_index: currentIndex,
            item_id: event.id,
            input: toolMeta.input,
          }),
        }
        yield {
          event: 'response.output_item.done',
          data: JSON.stringify({
            type: 'response.output_item.done',
            response_id: id,
            output_index: currentIndex,
            item: {
              type: 'custom_tool_call',
              id: event.id,
              call_id: toolMeta.callId,
              name: toolMeta.name,
              input: toolMeta.input,
            },
          }),
        }
        toolIndices.delete(event.id)
        continue
      }

      yield {
        event: 'response.output_item.done',
        data: JSON.stringify({
          type: 'response.output_item.done',
          response_id: id,
          output_index: currentIndex,
          item: {
            type: 'function_call',
            id: event.id,
            call_id: toolMeta?.callId ?? event.id,
          },
        }),
      }
      toolIndices.delete(event.id)
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
