import type { NormalizedEvent } from '../../core/stream-events'
import { iterableToSSEStream, type SSEMessage } from '../../lib/sse'

async function* toAnthropicSSE(events: AsyncIterable<NormalizedEvent>): AsyncGenerator<SSEMessage> {
  let id = `msg_${crypto.randomUUID().replace(/-/g, '')}`
  let model = 'unknown'
  let currentTextBlockIndex: number | null = null
  const toolBlockIndices = new Map<string, number>()
  let nextIndex = 0
  let latestUsage = { input_tokens: 0, output_tokens: 0 }

  for await (const event of events) {
    if (event.type === 'response_start') {
      model = event.model
      yield {
        event: 'message_start',
        data: JSON.stringify({
          type: 'message_start',
          message: {
            id,
            type: 'message',
            role: 'assistant',
            model,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: latestUsage,
          },
        }),
      }
      continue
    }

    if (event.type === 'content_delta') {
      if (currentTextBlockIndex === null) {
        currentTextBlockIndex = nextIndex++
        yield {
          event: 'content_block_start',
          data: JSON.stringify({
            type: 'content_block_start',
            index: currentTextBlockIndex,
            content_block: { type: 'text', text: '' },
          }),
        }
      }

      yield {
        event: 'content_block_delta',
        data: JSON.stringify({
          type: 'content_block_delta',
          index: currentTextBlockIndex,
          delta: { type: 'text_delta', text: event.text },
        }),
      }
      continue
    }

    if (event.type === 'tool_call_start') {
      const index = nextIndex++
      toolBlockIndices.set(event.id, index)
      yield {
        event: 'content_block_start',
        data: JSON.stringify({
          type: 'content_block_start',
          index,
          content_block: {
            type: 'tool_use',
            id: event.id,
            name: event.name,
            input: {},
          },
        }),
      }
      continue
    }

    if (event.type === 'tool_call_delta') {
      const index = toolBlockIndices.get(event.id) ?? 0
      yield {
        event: 'content_block_delta',
        data: JSON.stringify({
          type: 'content_block_delta',
          index,
          delta: { type: 'input_json_delta', partial_json: event.argumentsDelta },
        }),
      }
      continue
    }

    if (event.type === 'tool_call_end') {
      const index = toolBlockIndices.get(event.id)
      if (index !== undefined) {
        yield {
          event: 'content_block_stop',
          data: JSON.stringify({
            type: 'content_block_stop',
            index,
          }),
        }
        toolBlockIndices.delete(event.id)
      }
      continue
    }

    if (event.type === 'usage') {
      latestUsage = {
        input_tokens: event.usage.inputTokens ?? latestUsage.input_tokens,
        output_tokens: event.usage.outputTokens ?? latestUsage.output_tokens,
      }
      continue
    }

    if (event.type === 'response_end') {
      if (currentTextBlockIndex !== null) {
        yield {
          event: 'content_block_stop',
          data: JSON.stringify({
            type: 'content_block_stop',
            index: currentTextBlockIndex,
          }),
        }
      }

      yield {
        event: 'message_delta',
        data: JSON.stringify({
          type: 'message_delta',
          delta: {
            stop_reason: event.finishReason === 'tool_calls' ? 'tool_use' : event.finishReason ?? 'end_turn',
            stop_sequence: null,
          },
          usage: latestUsage,
        }),
      }
      yield {
        event: 'message_stop',
        data: JSON.stringify({ type: 'message_stop' }),
      }
      return
    }
  }
}

export function renderAnthropicMessagesStream(events: AsyncIterable<NormalizedEvent>): ReadableStream<Uint8Array> {
  return iterableToSSEStream(toAnthropicSSE(events))
}
