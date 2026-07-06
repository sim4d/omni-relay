import type { ContentBlock, NormalizedMessage, NormalizedRequest } from '../../core/ir'

function stringifyTextBlocks(blocks: ContentBlock[]): string | null {
  const text = blocks
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('')

  return text.length > 0 ? text : null
}

function toChatMessage(message: NormalizedMessage) {
  if (message.role === 'tool') {
    const toolResult = message.content.find((block): block is Extract<ContentBlock, { type: 'tool_result' }> => block.type === 'tool_result')

    return {
      role: 'tool',
      content: toolResult?.result ?? '',
      tool_call_id: toolResult?.toolCallId,
    }
  }

  const textContent = stringifyTextBlocks(message.content)
  const toolCalls = message.content
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
    role: message.role,
    content: textContent,
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  }
}

export function mapNormalizedRequestToOpenAIChatRequest(request: NormalizedRequest) {
  const instructionText = stringifyTextBlocks(request.instructions)

  return {
    model: request.targetModel,
    messages: [
      ...(instructionText ? [{ role: 'system', content: instructionText }] : []),
      ...request.messages.map(toChatMessage),
    ],
    tools: request.tools?.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    })),
    tool_choice:
      request.toolChoice?.type === 'tool'
        ? {
            type: 'function' as const,
            function: { name: request.toolChoice.name },
          }
        : request.toolChoice?.type,
    stream: request.stream,
    temperature: request.output?.temperature,
    max_completion_tokens: request.output?.maxOutputTokens,
    stop:
      request.output?.stop && request.output.stop.length === 1
        ? request.output.stop[0]
        : request.output?.stop,
  }
}
