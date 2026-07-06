import type { ContentBlock, NormalizedResult, Usage } from '../../core/ir'

function extractAssistantMessage(output: ContentBlock[]): {
  content: string | null
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
} {
  const text = output
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('')

  const toolCalls = output
    .filter((block): block is Extract<ContentBlock, { type: 'tool_call' }> => block.type === 'tool_call')
    .map((block) => ({
      id: block.id,
      type: 'function' as const,
      function: {
        name: block.name,
        arguments: block.argumentsJson,
      },
    }))

  return {
    content: text.length > 0 ? text : null,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
  }
}

function renderUsage(usage?: Usage) {
  if (!usage) return undefined

  return {
    prompt_tokens: usage.inputTokens ?? 0,
    completion_tokens: usage.outputTokens ?? 0,
    total_tokens: usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
  }
}

export function renderOpenAIChatResponse(result: NormalizedResult) {
  const message = extractAssistantMessage(result.output)
  const finishReason =
    result.finishReason === 'tool_call' || result.finishReason === 'tool_calls'
      ? 'tool_calls'
      : result.finishReason ?? 'stop'

  return {
    id: result.responseId ?? `chatcmpl_${crypto.randomUUID().replace(/-/g, '')}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: result.model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: message.content,
          tool_calls: message.tool_calls ?? null,
        },
        finish_reason: finishReason,
      },
    ],
    usage: renderUsage(result.usage),
  }
}
