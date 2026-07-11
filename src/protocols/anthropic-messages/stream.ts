import type { NormalizedEvent } from '../../core/stream-events'
import type { Usage } from '../../core/ir'
import { iterableToSSEStream, type SSEMessage } from '../../lib/sse'

function renderUsageFields(usage: Usage) {
  return {
    input_tokens: usage.inputTokens ?? 0,
    output_tokens: usage.outputTokens ?? 0,
    ...(typeof usage.cacheCreationInputTokens === 'number' ? { cache_creation_input_tokens: usage.cacheCreationInputTokens } : {}),
    ...(typeof usage.cacheReadInputTokens === 'number' ? { cache_read_input_tokens: usage.cacheReadInputTokens } : {}),
  }
}

function startBlock(index: number, type: 'text' | 'thinking'): SSEMessage {
  const contentBlock = type === 'text'
    ? { type: 'text', text: '' }
    : { type: 'thinking', thinking: '' }
  return {
    event: 'content_block_start',
    data: JSON.stringify({
      type: 'content_block_start',
      index,
      content_block: contentBlock,
    }),
  }
}

async function* toAnthropicSSE(events: AsyncIterable<NormalizedEvent>): AsyncGenerator<SSEMessage> {
  const id = `msg_${crypto.randomUUID().replace(/-/g, '')}`
  let model = 'unknown'
  let currentTextBlockIndex: number | null = null
  let currentThinkingBlockIndex: number | null = null
  const toolBlockIndices = new Map<string, number>()
  let nextIndex = 0
  let latestUsage: Usage = { inputTokens: 0, outputTokens: 0 }

  const closeBlock = function* (index: number | null): Generator<SSEMessage> {
    if (index === null) return
    yield {
      event: 'content_block_stop',
      data: JSON.stringify({ type: 'content_block_stop', index }),
    }
  }

  let sseMessageStartSent = false

  const emitSseMessageStart = function* (): Generator<SSEMessage> {
    if (sseMessageStartSent) return
    sseMessageStartSent = true
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
          usage: renderUsageFields(latestUsage),
        },
      }),
    }
  }

  for await (const event of events) {
    if (event.type === 'response_start') {
      model = event.model
      continue
    }

    if (event.type === 'message_start') {
      // Emit the SSE message_start now (after any preceding usage event has
      // been stashed), so input/cache token counts are non-zero.
      yield* emitSseMessageStart()
      continue
    }

    if (event.type === 'content_delta') {
      // Defensive: ensure message_start was emitted before any content. Upstream
      // mappers always emit it first, but guard against malformed event streams.
      yield* emitSseMessageStart()

      // Close any open thinking block before opening a text block, so block
      // lifetimes never overlap (Anthropic expects sequential blocks). Symmetric
      // with the reasoning_delta handler closing the text block below.
      if (currentThinkingBlockIndex !== null) {
        yield* closeBlock(currentThinkingBlockIndex)
        currentThinkingBlockIndex = null
      }

      if (currentTextBlockIndex === null) {
        currentTextBlockIndex = nextIndex++
        yield startBlock(currentTextBlockIndex, 'text')
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

    if (event.type === 'reasoning_delta') {
      // Defensive: ensure message_start was emitted before any content.
      yield* emitSseMessageStart()

      // Close any open text block before opening a thinking block, so block
      // lifetimes never overlap (Anthropic expects sequential blocks).
      yield* closeBlock(currentTextBlockIndex)
      currentTextBlockIndex = null

      if (currentThinkingBlockIndex === null) {
        currentThinkingBlockIndex = nextIndex++
        yield startBlock(currentThinkingBlockIndex, 'thinking')
      }

      if (event.text.length > 0) {
        yield {
          event: 'content_block_delta',
          data: JSON.stringify({
            type: 'content_block_delta',
            index: currentThinkingBlockIndex,
            delta: { type: 'thinking_delta', thinking: event.text },
          }),
        }
      }
      if (event.signatureDelta) {
        yield {
          event: 'content_block_delta',
          data: JSON.stringify({
            type: 'content_block_delta',
            index: currentThinkingBlockIndex,
            delta: { type: 'signature_delta', signature: event.signatureDelta },
          }),
        }
      }
      continue
    }

    if (event.type === 'tool_call_start') {
      // Defensive: ensure message_start was emitted before any content.
      yield* emitSseMessageStart()
      // Close any open text/thinking block before starting a tool_use block.
      yield* closeBlock(currentTextBlockIndex)
      currentTextBlockIndex = null
      yield* closeBlock(currentThinkingBlockIndex)
      currentThinkingBlockIndex = null

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
        inputTokens: event.usage.inputTokens ?? latestUsage.inputTokens,
        outputTokens: event.usage.outputTokens ?? latestUsage.outputTokens,
        cacheCreationInputTokens: event.usage.cacheCreationInputTokens ?? latestUsage.cacheCreationInputTokens,
        cacheReadInputTokens: event.usage.cacheReadInputTokens ?? latestUsage.cacheReadInputTokens,
        reasoningTokens: event.usage.reasoningTokens ?? latestUsage.reasoningTokens,
      }
      continue
    }

    if (event.type === 'response_end') {
      // Guarantee message_start is emitted even when the upstream stream
      // terminated without any content/message_start events (e.g. an empty or
      // immediately-closing stream). Without this the client would receive
      // message_delta/message_stop with no preceding message_start.
      yield* emitSseMessageStart()

      yield* closeBlock(currentTextBlockIndex)
      currentTextBlockIndex = null
      yield* closeBlock(currentThinkingBlockIndex)
      currentThinkingBlockIndex = null

      yield {
        event: 'message_delta',
        data: JSON.stringify({
          type: 'message_delta',
          delta: {
            stop_reason: event.finishReason === 'tool_calls' ? 'tool_use' : event.finishReason ?? 'end_turn',
            stop_sequence: null,
          },
          usage: renderUsageFields(latestUsage),
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
