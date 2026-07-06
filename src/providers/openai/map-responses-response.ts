import { UpstreamAPIError } from '../../errors'
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

  if (typeof record.output_text === 'string' && record.output_text.length > 0) {
    output.push({ type: 'text', text: record.output_text })
  }

  if (!Array.isArray(record.output)) {
    return output
  }

  for (const item of record.output) {
    if (!item || typeof item !== 'object') continue
    const outputItem = item as Record<string, unknown>

    if (outputItem.type === 'message') {
      output.push(...parseOutputTextContent(outputItem.content))
      continue
    }

    if (outputItem.type === 'function_call' && typeof outputItem.name === 'string') {
      output.push({
        type: 'tool_call',
        id: typeof outputItem.call_id === 'string' ? outputItem.call_id : typeof outputItem.id === 'string' ? outputItem.id : crypto.randomUUID(),
        name: outputItem.name,
        argumentsJson:
          typeof outputItem.arguments === 'string'
            ? outputItem.arguments
            : JSON.stringify(outputItem.arguments ?? {}),
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

  return {
    model: typeof record.model === 'string' ? record.model : 'unknown',
    provider: 'openai',
    output,
    finishReason: output.some((block) => block.type === 'tool_call') ? 'tool_calls' : 'stop',
    usage: usage
      ? {
          inputTokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : undefined,
          outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined,
          totalTokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : undefined,
        }
      : undefined,
    responseId: typeof record.id === 'string' ? record.id : undefined,
    extensions: {
      status: record.status,
    },
  }
}
