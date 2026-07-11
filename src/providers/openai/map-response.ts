import { UpstreamAPIError } from '../../errors'
import { readNestedNumber } from '../../core/usage'
import type { ContentBlock, NormalizedResult } from '../../core/ir'

function normalizeOutput(message: Record<string, unknown>): ContentBlock[] {
  const output: ContentBlock[] = []

  // Reasoning content (o-series / reasoning models).
  if (typeof message.reasoning === 'string' && message.reasoning.length > 0) {
    output.push({ type: 'reasoning', text: message.reasoning })
  } else if (typeof message.reasoning_content === 'string' && message.reasoning_content.length > 0) {
    output.push({ type: 'reasoning', text: message.reasoning_content })
  }

  if (typeof message.content === 'string' && message.content.length > 0) {
    output.push({ type: 'text', text: message.content })
  } else if (Array.isArray(message.content)) {
    // Some Chat servers return content as multi-part array.
    for (const part of message.content) {
      if (!part || typeof part !== 'object') continue
      const record = part as Record<string, unknown>
      if (record.type === 'text' && typeof record.text === 'string') {
        output.push({ type: 'text', text: record.text })
      }
    }
  }

  if (Array.isArray(message.tool_calls)) {
    for (const toolCall of message.tool_calls) {
      if (!toolCall || typeof toolCall !== 'object') continue
      const record = toolCall as Record<string, unknown>
      const fn = record.function as Record<string, unknown> | undefined
      if (typeof record.id === 'string' && fn && typeof fn.name === 'string' && typeof fn.arguments === 'string') {
        output.push({
          type: 'tool_call',
          id: record.id,
          name: fn.name,
          argumentsJson: fn.arguments,
        })
      }
    }
  }

  return output
}

export function mapOpenAIChatResponseToNormalizedResult(payload: unknown): NormalizedResult {
  if (!payload || typeof payload !== 'object') {
    throw new UpstreamAPIError('OpenAI upstream response was not an object', { payload })
  }

  const record = payload as Record<string, unknown>
  const choices = Array.isArray(record.choices) ? record.choices : []
  const firstChoice = choices[0]

  if (!firstChoice || typeof firstChoice !== 'object') {
    throw new UpstreamAPIError('OpenAI upstream response did not include choices[0]', { payload })
  }

  const choice = firstChoice as Record<string, unknown>
  const message = choice.message

  if (!message || typeof message !== 'object') {
    throw new UpstreamAPIError('OpenAI upstream choice did not include a message object', { payload })
  }

  const usage = record.usage && typeof record.usage === 'object' ? record.usage as Record<string, unknown> : undefined

  return {
    model: typeof record.model === 'string' ? record.model : 'unknown',
    provider: 'openai',
    output: normalizeOutput(message as Record<string, unknown>),
    finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : undefined,
    usage: usage
      ? {
          inputTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : undefined,
          outputTokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : undefined,
          totalTokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : undefined,
          cacheReadInputTokens: readNestedNumber(usage, ['prompt_tokens_details', 'cached_tokens']),
          reasoningTokens: readNestedNumber(usage, ['completion_tokens_details', 'reasoning_tokens']),
        }
      : undefined,
    responseId: typeof record.id === 'string' ? record.id : undefined,
    extensions: {
      object: record.object,
    },
  }
}
