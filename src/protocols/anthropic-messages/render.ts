import type { ContentBlock, NormalizedResult } from '../../core/ir'

function parseToolInput(argumentsJson: string): unknown {
  try {
    return JSON.parse(argumentsJson)
  } catch {
    return argumentsJson
  }
}

function renderContent(output: ContentBlock[]) {
  return output.flatMap<Record<string, unknown>>((block) => {
    if (block.type === 'text') {
      return [{ type: 'text', text: block.text }]
    }

    if (block.type === 'tool_call') {
      return [{
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: parseToolInput(block.argumentsJson),
      }]
    }

    return []
  })
}

function renderStopReason(result: NormalizedResult): string {
  if (result.output.some((block) => block.type === 'tool_call')) {
    return 'tool_use'
  }

  return 'end_turn'
}

export function renderAnthropicMessagesResponse(result: NormalizedResult) {
  return {
    id: result.responseId ?? `msg_${crypto.randomUUID().replace(/-/g, '')}`,
    type: 'message',
    role: 'assistant',
    model: result.model,
    content: renderContent(result.output),
    stop_reason: renderStopReason(result),
    stop_sequence: null,
    usage: {
      input_tokens: result.usage?.inputTokens ?? 0,
      output_tokens: result.usage?.outputTokens ?? 0,
    },
  }
}
