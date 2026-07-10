import { coalesceAdjacentToolMessages } from '../../core/ir-normalize'
import type { ContentBlock, NormalizedMessage, NormalizedRequest } from '../../core/ir'

function parseArguments(argumentsJson: string): unknown {
  try {
    return JSON.parse(argumentsJson)
  } catch {
    return argumentsJson
  }
}

function blocksToAnthropicContent(blocks: ContentBlock[]) {
  return blocks.flatMap((block) => {
    if (block.type === 'text') {
      return [{ type: 'text', text: block.text }]
    }

    if (block.type === 'tool_call') {
      return [{
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: parseArguments(block.argumentsJson),
      }]
    }

    if (block.type === 'tool_result') {
      return [{
        type: 'tool_result',
        tool_use_id: block.toolCallId,
        content: block.result,
        is_error: block.isError,
      }]
    }

    return [block.payload]
  })
}

function messageToAnthropic(message: NormalizedMessage) {
  if (message.role === 'tool') {
    return {
      role: 'user',
      content: blocksToAnthropicContent(message.content),
    }
  }

  return {
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: blocksToAnthropicContent(message.content),
  }
}

function instructionsToAnthropicSystem(instructions: ContentBlock[]): string | Array<Record<string, unknown>> | undefined {
  if (instructions.length === 0) return undefined

  const onlyText = instructions.every((block) => block.type === 'text')
  if (onlyText) {
    return instructions
      .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
  }

  return blocksToAnthropicContent(instructions) as Array<Record<string, unknown>>
}

export function mapNormalizedRequestToAnthropicMessagesRequest(request: NormalizedRequest) {
  const messages = coalesceAdjacentToolMessages(request.messages)
  return {
    model: request.targetModel,
    max_tokens: request.output?.maxOutputTokens ?? 1024,
    system: instructionsToAnthropicSystem(request.instructions),
    messages: messages.map(messageToAnthropic),
    tools: request.tools?.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema ?? { type: 'object', properties: {} },
    })),
    tool_choice:
      request.toolChoice?.type === 'auto'
        ? { type: 'auto' }
        : request.toolChoice?.type === 'required'
          ? { type: 'any' }
          : request.toolChoice?.type === 'tool'
            ? { type: 'tool', name: request.toolChoice.name }
            : undefined,
    temperature: request.output?.temperature,
    stop_sequences: request.output?.stop,
    metadata: request.metadata,
    stream: request.stream,
  }
}
