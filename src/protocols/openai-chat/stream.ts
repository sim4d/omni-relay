import type { NormalizedEvent } from '../../core/stream-events'
import type { Usage } from '../../core/ir'
import { iterableToSSEStream, type SSEMessage } from '../../lib/sse'

function finishReasonFromEvent(event: Extract<NormalizedEvent, { type: 'response_end' }>): string {
  if (event.finishReason === 'tool_call' || event.finishReason === 'tool_calls') return 'tool_calls'
  return event.finishReason ?? 'stop'
}

function renderUsage(usage?: Usage) {
  if (!usage) return undefined
  const promptTokensDetails =
    typeof usage.cacheReadInputTokens === 'number'
      ? { cached_tokens: usage.cacheReadInputTokens }
      : undefined
  const completionTokensDetails =
    typeof usage.reasoningTokens === 'number'
      ? { reasoning_tokens: usage.reasoningTokens }
      : undefined
  return {
    prompt_tokens: usage.inputTokens ?? 0,
    completion_tokens: usage.outputTokens ?? 0,
    total_tokens: usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
    ...(promptTokensDetails ? { prompt_tokens_details: promptTokensDetails } : {}),
    ...(completionTokensDetails ? { completion_tokens_details: completionTokensDetails } : {}),
  }
}

async function* toOpenAIChatSSE(events: AsyncIterable<NormalizedEvent>, includeUsage = false): AsyncGenerator<SSEMessage> {
  let model = 'unknown'
  let id = `chatcmpl_${crypto.randomUUID().replace(/-/g, '')}`
  const created = Math.floor(Date.now() / 1000)
  const toolIndices = new Map<string, number>()
  let nextToolIndex = 0
  let pendingUsage: Usage | undefined

  const base = () => ({
    id,
    object: 'chat.completion.chunk',
    created,
    model,
  })

  for await (const event of events) {
    if (event.type === 'response_start') {
      model = event.model
      continue
    }

    if (event.type === 'message_start') {
      yield {
        data: JSON.stringify({
          ...base(),
          choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
        }),
      }
      continue
    }

    if (event.type === 'content_delta') {
      yield {
        data: JSON.stringify({
          ...base(),
          choices: [{ index: 0, delta: { content: event.text }, finish_reason: null }],
        }),
      }
      continue
    }

    if (event.type === 'reasoning_delta') {
      // OpenAI reasoning models surface this as delta.reasoning_content.
      if (event.text.length > 0) {
        yield {
          data: JSON.stringify({
            ...base(),
            choices: [{ index: 0, delta: { reasoning_content: event.text }, finish_reason: null }],
          }),
        }
      }
      continue
    }

    if (event.type === 'tool_call_start') {
      const index = nextToolIndex++
      toolIndices.set(event.id, index)
      yield {
        data: JSON.stringify({
          ...base(),
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
          ...base(),
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

    if (event.type === 'usage') {
      pendingUsage = event.usage
      continue
    }

    if (event.type === 'response_end') {
      // OpenAI's include_usage contract: the finish_reason chunk comes FIRST,
      // then a terminal chunk with empty `choices` + `usage`, then [DONE].
      yield {
        data: JSON.stringify({
          ...base(),
          choices: [{ index: 0, delta: {}, finish_reason: finishReasonFromEvent(event) }],
        }),
      }
      if (includeUsage && pendingUsage) {
        yield {
          data: JSON.stringify({
            ...base(),
            choices: [],
            usage: renderUsage(pendingUsage),
          }),
        }
      }
      yield { data: '[DONE]' }
      return
    }
  }
}

export function renderOpenAIChatStream(events: AsyncIterable<NormalizedEvent>, includeUsage = false): ReadableStream<Uint8Array> {
  return iterableToSSEStream(toOpenAIChatSSE(events, includeUsage))
}
