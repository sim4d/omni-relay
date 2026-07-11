import type { NormalizedEvent } from '../../core/stream-events'
import type { Usage } from '../../core/ir'
import { iterableToSSEStream, type SSEMessage } from '../../lib/sse'

function renderUsage(usage: Usage) {
  const inputTokensDetails =
    typeof usage.cacheReadInputTokens === 'number'
      ? { cached_tokens: usage.cacheReadInputTokens }
      : undefined
  const outputTokensDetails =
    typeof usage.reasoningTokens === 'number'
      ? { reasoning_tokens: usage.reasoningTokens }
      : undefined
  return {
    input_tokens: usage.inputTokens ?? 0,
    output_tokens: usage.outputTokens ?? 0,
    total_tokens: usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
    ...(inputTokensDetails ? { input_tokens_details: inputTokensDetails } : {}),
    ...(outputTokensDetails ? { output_tokens_details: outputTokensDetails } : {}),
  }
}

async function* toOpenAIResponsesSSE(events: AsyncIterable<NormalizedEvent>): AsyncGenerator<SSEMessage> {
  let id = `resp_${crypto.randomUUID().replace(/-/g, '')}`
  let model = 'unknown'
  let outputIndex = 0
  let latestUsage: Usage | undefined
  const toolIndices = new Map<string, { outputIndex: number; toolType?: 'function' | 'custom'; callId: string; input: string; name: string }>()
  let sawToolCall = false
  let activeTextItem:
    | {
        itemId: string
        outputIndex: number
        contentIndex: number
        text: string
      }
    | undefined
  let activeReasoningItem:
    | {
        itemId: string
        outputIndex: number
        contentIndex: number
        text: string
      }
    | undefined

  const finalizeActiveTextItem = async function* (): AsyncGenerator<SSEMessage> {
    if (!activeTextItem) return

    yield {
      event: 'response.output_text.done',
      data: JSON.stringify({
        type: 'response.output_text.done',
        response_id: id,
        item_id: activeTextItem.itemId,
        output_index: activeTextItem.outputIndex,
        content_index: activeTextItem.contentIndex,
        text: activeTextItem.text,
      }),
    }
    yield {
      event: 'response.content_part.done',
      data: JSON.stringify({
        type: 'response.content_part.done',
        response_id: id,
        item_id: activeTextItem.itemId,
        output_index: activeTextItem.outputIndex,
        content_index: activeTextItem.contentIndex,
        part: {
          type: 'text',
          text: activeTextItem.text,
        },
      }),
    }
    yield {
      event: 'response.output_item.done',
      data: JSON.stringify({
        type: 'response.output_item.done',
        response_id: id,
        output_index: activeTextItem.outputIndex,
        item: {
          id: activeTextItem.itemId,
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [
            {
              type: 'output_text',
              text: activeTextItem.text,
              annotations: [],
            },
          ],
        },
      }),
    }
    activeTextItem = undefined
  }

  const finalizeActiveReasoningItem = async function* (): AsyncGenerator<SSEMessage> {
    if (!activeReasoningItem) return

    yield {
      event: 'response.reasoning_summary_text.done',
      data: JSON.stringify({
        type: 'response.reasoning_summary_text.done',
        response_id: id,
        item_id: activeReasoningItem.itemId,
        output_index: activeReasoningItem.outputIndex,
        content_index: activeReasoningItem.contentIndex,
        text: activeReasoningItem.text,
      }),
    }
    yield {
      event: 'response.output_item.done',
      data: JSON.stringify({
        type: 'response.output_item.done',
        response_id: id,
        output_index: activeReasoningItem.outputIndex,
        item: {
          id: activeReasoningItem.itemId,
          type: 'reasoning',
          status: 'completed',
          summary: [{ type: 'summary_text', text: activeReasoningItem.text }],
        },
      }),
    }
    activeReasoningItem = undefined
  }

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
      // Finalize any active reasoning item before opening a text item, so output
      // items complete in index order (symmetric with tool_call_start below).
      yield* finalizeActiveReasoningItem()
      if (!activeTextItem) {
        activeTextItem = {
          itemId: `msg_${crypto.randomUUID().replace(/-/g, '')}`,
          outputIndex: outputIndex++,
          contentIndex: 0,
          text: '',
        }
        yield {
          event: 'response.output_item.added',
          data: JSON.stringify({
            type: 'response.output_item.added',
            response_id: id,
            output_index: activeTextItem.outputIndex,
            item: {
              id: activeTextItem.itemId,
              type: 'message',
              role: 'assistant',
              status: 'in_progress',
              content: [],
            },
          }),
        }
        yield {
          event: 'response.content_part.added',
          data: JSON.stringify({
            type: 'response.content_part.added',
            response_id: id,
            item_id: activeTextItem.itemId,
            output_index: activeTextItem.outputIndex,
            content_index: activeTextItem.contentIndex,
            part: {
              type: 'text',
              text: '',
            },
          }),
        }
      }

      activeTextItem.text += event.text
      yield {
        event: 'response.output_text.delta',
        data: JSON.stringify({
          type: 'response.output_text.delta',
          response_id: id,
          item_id: activeTextItem.itemId,
          output_index: activeTextItem.outputIndex,
          content_index: activeTextItem.contentIndex,
          delta: event.text,
        }),
      }
      continue
    }

    if (event.type === 'reasoning_delta') {
      if (!activeReasoningItem) {
        activeReasoningItem = {
          itemId: `rs_${crypto.randomUUID().replace(/-/g, '')}`,
          outputIndex: outputIndex++,
          contentIndex: 0,
          text: '',
        }
        yield {
          event: 'response.output_item.added',
          data: JSON.stringify({
            type: 'response.output_item.added',
            response_id: id,
            output_index: activeReasoningItem.outputIndex,
            item: {
              id: activeReasoningItem.itemId,
              type: 'reasoning',
              status: 'in_progress',
              summary: [],
            },
          }),
        }
      }

      // Only emit a delta when there is text to carry. A reasoning_delta with
      // empty text can arrive when it carries only a signatureDelta (Anthropic
      // signature_delta forwarded cross-provider); the Responses protocol has
      // no equivalent, so skip the empty delta to avoid a no-op frame.
      if (event.text.length > 0) {
        activeReasoningItem.text += event.text
        yield {
          event: 'response.reasoning_summary_text.delta',
          data: JSON.stringify({
            type: 'response.reasoning_summary_text.delta',
            response_id: id,
            item_id: activeReasoningItem.itemId,
            output_index: activeReasoningItem.outputIndex,
            content_index: activeReasoningItem.contentIndex,
            delta: event.text,
          }),
        }
      }
      continue
    }

    if (event.type === 'tool_call_start') {
      yield* finalizeActiveTextItem()
      yield* finalizeActiveReasoningItem()
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
      if (toolMeta) {
        toolMeta.input += event.argumentsDelta
      }
      if (toolMeta?.toolType === 'custom') {
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
          output_index: toolMeta?.outputIndex ?? 0,
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
        event: 'response.function_call_arguments.done',
        data: JSON.stringify({
          type: 'response.function_call_arguments.done',
          response_id: id,
          item_id: event.id,
          output_index: currentIndex,
          arguments: toolMeta?.input ?? '',
        }),
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
            name: toolMeta?.name ?? 'function',
            arguments: toolMeta?.input ?? '',
          },
        }),
      }
      toolIndices.delete(event.id)
      continue
    }

    if (event.type === 'usage') {
      latestUsage = event.usage
      continue
    }

    if (event.type === 'response_end') {
      yield* finalizeActiveTextItem()
      yield* finalizeActiveReasoningItem()

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
            ...(latestUsage ? { usage: renderUsage(latestUsage) } : {}),
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
