import { UpstreamAPIError } from '../../errors'
import { readNestedNumber } from '../../core/usage'
import type { ContentBlock, NormalizedResult } from '../../core/ir'

function parseOutputTextContent(content: unknown): ContentBlock[] {
  if (!Array.isArray(content)) return []

  return content.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>

    if ((record.type === 'output_text' || record.type === 'text') && typeof record.text === 'string') {
      return [{ type: 'text', text: record.text } satisfies ContentBlock]
    }

    return []
  })
}

function normalizeOutput(record: Record<string, unknown>): ContentBlock[] {
  const output: ContentBlock[] = []

  // Top-level reasoning summary text (Responses API may surface reasoning
  // as output items of type 'reasoning').
  if (!Array.isArray(record.output)) {
    if (typeof record.output_text === 'string' && record.output_text.length > 0) {
      output.push({ type: 'text', text: record.output_text })
    }
    return output
  }

  for (const item of record.output) {
    if (!item || typeof item !== 'object') continue
    const outputItem = item as Record<string, unknown>

    if (outputItem.type === 'message') {
      output.push(...parseOutputTextContent(outputItem.content))
      continue
    }

    if (outputItem.type === 'reasoning' && Array.isArray(outputItem.summary)) {
      const text = outputItem.summary
        .map((s) => (s && typeof s === 'object' && typeof (s as Record<string, unknown>).text === 'string' ? (s as Record<string, unknown>).text as string : ''))
        .join('')
      if (text.length > 0) {
        output.push({ type: 'reasoning', text })
      }
      continue
    }

    if (outputItem.type === 'function_call' && typeof outputItem.name === 'string') {
      const id = typeof outputItem.id === 'string' ? outputItem.id : crypto.randomUUID()
      const callId = typeof outputItem.call_id === 'string' ? outputItem.call_id : id
      output.push({
        type: 'tool_call',
        id,
        callId,
        name: outputItem.name,
        argumentsJson:
          typeof outputItem.arguments === 'string'
            ? outputItem.arguments
            : JSON.stringify(outputItem.arguments ?? {}),
      })
      continue
    }

    if (outputItem.type === 'custom_tool_call' && typeof outputItem.name === 'string' && typeof outputItem.input === 'string') {
      output.push({
        type: 'provider_extension',
        provider: 'openai',
        name: 'custom_tool_call',
        payload: outputItem,
      })
    }
  }

  return output
}

export function mapOpenAIResponsesResponseToNormalizedResult(payload: unknown): NormalizedResult {
  if (!payload || typeof payload !== 'object') {
    throw new UpstreamAPIError('OpenAI Responses upstream response was not an object', { payload })
  }

  const record = payload as Record<string, unknown>
  const usage = record.usage && typeof record.usage === 'object' ? record.usage as Record<string, unknown> : undefined
  const output = normalizeOutput(record)
  const sawToolCall = output.some((block) =>
    block.type === 'tool_call'
    || (block.type === 'provider_extension' && block.provider === 'openai' && block.name === 'custom_tool_call'),
  )

  return {
    model: typeof record.model === 'string' ? record.model : 'unknown',
    provider: 'openai',
    output,
    finishReason: sawToolCall ? 'tool_calls' : 'stop',
    usage: usage
      ? {
          inputTokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : undefined,
          outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined,
          totalTokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : undefined,
          cacheReadInputTokens: readNestedNumber(usage, ['input_tokens_details', 'cached_tokens']),
          reasoningTokens: readNestedNumber(usage, ['output_tokens_details', 'reasoning_tokens']),
        }
      : undefined,
    responseId: typeof record.id === 'string' ? record.id : undefined,
    extensions: {
      status: record.status,
    },
  }
}
