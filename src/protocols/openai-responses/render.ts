import type { ContentBlock, NormalizedResult, Usage } from '../../core/ir'

function extractText(output: ContentBlock[]): string {
  return output
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('')
}

function extractOutputItems(output: ContentBlock[]) {
  const text = extractText(output)
  const items: Array<Record<string, unknown>> = []

  if (text) {
    items.push({
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'output_text',
          text,
          annotations: [],
        },
      ],
    })
  }

  for (const block of output) {
    if (block.type !== 'tool_call') continue
    items.push({
      type: 'function_call',
      id: block.id,
      call_id: block.id,
      name: block.name,
      arguments: block.argumentsJson,
    })
  }

  return items
}

function renderUsage(usage?: Usage) {
  if (!usage) return undefined
  return {
    input_tokens: usage.inputTokens ?? 0,
    output_tokens: usage.outputTokens ?? 0,
    total_tokens: usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
  }
}

export function renderOpenAIResponsesResponse(result: NormalizedResult) {
  const outputText = extractText(result.output)
  const outputItems = extractOutputItems(result.output)

  return {
    id: result.responseId ?? `resp_${crypto.randomUUID().replace(/-/g, '')}`,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status: 'completed',
    model: result.model,
    output: outputItems,
    output_text: outputText,
    usage: renderUsage(result.usage),
    error: null,
  }
}
