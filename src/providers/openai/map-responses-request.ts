import type { ContentBlock, NormalizedMessage, NormalizedRequest } from '../../core/ir'

function blocksToInputContent(blocks: ContentBlock[]) {
  return blocks.map((block) => {
    if (block.type === 'text') {
      return { type: 'input_text', text: block.text }
    }

    if (block.type === 'tool_call') {
      return {
        type: 'function_call',
        call_id: block.id,
        name: block.name,
        arguments: block.argumentsJson,
      }
    }

    if (block.type === 'tool_result') {
      return {
        type: 'function_call_output',
        call_id: block.toolCallId,
        output: block.result,
      }
    }

    return block.payload
  })
}

function messageToInputItem(message: NormalizedMessage) {
  return {
    role: message.role,
    content: blocksToInputContent(message.content),
  }
}

function instructionsToText(instructions: ContentBlock[]): string | undefined {
  const text = instructions
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('\n')

  return text || undefined
}

export function mapNormalizedRequestToOpenAIResponsesRequest(request: NormalizedRequest) {
  return {
    model: request.targetModel,
    instructions: instructionsToText(request.instructions),
    input: request.messages.map(messageToInputItem),
    tools: request.tools?.map((tool) => ({
      type: 'function' as const,
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    })),
    tool_choice:
      request.toolChoice?.type === 'tool'
        ? { type: 'function', name: request.toolChoice.name }
        : request.toolChoice?.type,
    temperature: request.output?.temperature,
    max_output_tokens: request.output?.maxOutputTokens,
    metadata: request.metadata,
    stream: request.stream,
    ...(request.extensions?.openai?.text ? { text: request.extensions.openai.text } : {}),
  }
}
