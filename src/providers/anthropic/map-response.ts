import { UpstreamAPIError } from '../../errors'
import type { ContentBlock, NormalizedResult } from '../../core/ir'

function normalizeContent(content: unknown): ContentBlock[] {
  if (!Array.isArray(content)) return []

  return content.flatMap<ContentBlock>((block) => {
    if (!block || typeof block !== 'object') return []
    const record = block as Record<string, unknown>

    if (record.type === 'text' && typeof record.text === 'string') {
      return [{ type: 'text', text: record.text } satisfies ContentBlock]
    }

    if (record.type === 'thinking' && typeof record.thinking === 'string') {
      return [{
        type: 'reasoning',
        text: record.thinking,
        signature: typeof record.signature === 'string' ? record.signature : undefined,
      } satisfies ContentBlock]
    }

    if (record.type === 'redacted_thinking') {
      return [{
        type: 'provider_extension',
        provider: 'anthropic',
        name: 'redacted_thinking',
        payload: record,
      } satisfies ContentBlock]
    }

    if (record.type === 'tool_use' && typeof record.id === 'string' && typeof record.name === 'string') {
      return [{
        type: 'tool_call',
        id: record.id,
        callId: typeof record.call_id === 'string' ? record.call_id : undefined,
        name: record.name,
        argumentsJson:
          typeof record.input === 'string'
            ? record.input
            : JSON.stringify(record.input ?? {}),
      } satisfies ContentBlock]
    }

    return []
  })
}

export function mapAnthropicMessagesResponseToNormalizedResult(payload: unknown): NormalizedResult {
  if (!payload || typeof payload !== 'object') {
    throw new UpstreamAPIError('Anthropic upstream response was not an object', { payload })
  }

  const record = payload as Record<string, unknown>
  const usage = record.usage && typeof record.usage === 'object' ? record.usage as Record<string, unknown> : undefined
  const output = normalizeContent(record.content)

  return {
    model: typeof record.model === 'string' ? record.model : 'unknown',
    provider: 'anthropic',
    output,
    finishReason: output.some((block) => block.type === 'tool_call') ? 'tool_calls' : typeof record.stop_reason === 'string' ? record.stop_reason : 'stop',
    usage: usage
      ? {
          inputTokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : undefined,
          outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined,
          totalTokens:
            typeof usage.input_tokens === 'number' && typeof usage.output_tokens === 'number'
              ? usage.input_tokens + usage.output_tokens
              : undefined,
          cacheCreationInputTokens: typeof usage.cache_creation_input_tokens === 'number' ? usage.cache_creation_input_tokens : undefined,
          cacheReadInputTokens: typeof usage.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : undefined,
        }
      : undefined,
    responseId: typeof record.id === 'string' ? record.id : undefined,
    extensions: {
      stop_reason: record.stop_reason,
    },
  }
}
