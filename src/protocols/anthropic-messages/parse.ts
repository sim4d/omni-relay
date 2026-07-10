import { ValidationError } from '../../errors'
import type { ContentBlock, NormalizedMessage, NormalizedRequest, NormalizedTool, ToolChoice } from '../../core/ir'
import { coalesceAdjacentAssistantToolCalls } from '../../core/ir-normalize'
import { anthropicMessagesRequestSchema } from './schema'

function textBlock(text: string): ContentBlock {
  return { type: 'text', text }
}

function parseContentBlocks(content: string | Array<Record<string, unknown>>): ContentBlock[] {
  if (typeof content === 'string') {
    return [textBlock(content)]
  }

  return content.flatMap((block) => {
    if (block.type === 'text' && typeof block.text === 'string') {
      return [textBlock(block.text)]
    }

    if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
      return [{
        type: 'tool_call',
        id: block.id,
        name: block.name,
        argumentsJson:
          typeof block.input === 'string'
            ? block.input
            : JSON.stringify(block.input ?? {}),
      } satisfies ContentBlock]
    }

    if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
      return [{
        type: 'tool_result',
        toolCallId: block.tool_use_id,
        result:
          typeof block.content === 'string'
            ? block.content
            : JSON.stringify(block.content ?? null),
        isError: typeof block.is_error === 'boolean' ? block.is_error : undefined,
      } satisfies ContentBlock]
    }

    return [{ type: 'provider_extension', provider: 'anthropic', name: String(block.type ?? 'content_block'), payload: block } satisfies ContentBlock]
  })
}

function normalizeSystem(system: string | Array<Record<string, unknown>> | undefined): ContentBlock[] {
  if (!system) return []
  return parseContentBlocks(system)
}

function normalizeMessages(
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string | Array<Record<string, unknown>> }>,
): { instructions: ContentBlock[]; messages: NormalizedMessage[] } {
  const instructions: ContentBlock[] = []
  const normalizedMessages: NormalizedMessage[] = []

  for (const message of messages) {
    const content = parseContentBlocks(message.content)
    if (message.role === 'system') {
      instructions.push(...content)
      continue
    }

    if (message.role === 'user') {
      let pendingUserContent: ContentBlock[] = []
      for (const block of content) {
        if (block.type === 'tool_result') {
          if (pendingUserContent.length > 0) {
            normalizedMessages.push({
              role: 'user',
              content: pendingUserContent,
            })
            pendingUserContent = []
          }
          normalizedMessages.push({
            role: 'tool',
            content: [block],
          })
          continue
        }

        pendingUserContent.push(block)
      }

      if (pendingUserContent.length > 0) {
        normalizedMessages.push({
          role: 'user',
          content: pendingUserContent,
        })
      }
      continue
    }

    normalizedMessages.push({
      role: message.role,
      content,
    })
  }

  return {
    instructions,
    messages: normalizedMessages,
  }
}

function normalizeTools(tools: Array<{ name: string; description?: string; input_schema: unknown }> | undefined): NormalizedTool[] | undefined {
  if (!tools?.length) return undefined
  return tools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    inputSchema: tool.input_schema,
  }))
}

function normalizeToolChoice(toolChoice: { type: 'auto' | 'any' } | { type: 'tool'; name: string } | undefined): ToolChoice | undefined {
  if (!toolChoice) return undefined
  if (toolChoice.type === 'auto') return { type: 'auto' }
  if (toolChoice.type === 'any') return { type: 'required' }
  if (toolChoice.type === 'tool') {
    return { type: 'tool', name: toolChoice.name }
  }

  return undefined
}

export function parseAnthropicMessagesRequest(input: unknown): NormalizedRequest {
  const parsed = anthropicMessagesRequestSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('Anthropic Messages request validation failed', parsed.error.flatten())
  }

  const request = parsed.data
  const normalizedMessages = normalizeMessages(
    request.messages as Array<{ role: 'user' | 'assistant' | 'system'; content: string | Array<Record<string, unknown>> }>,
  )

  return {
    targetModel: request.model,
    providerHint: request.providerHint,
    instructions: [
      ...normalizeSystem(request.system as string | Array<Record<string, unknown>> | undefined),
      ...normalizedMessages.instructions,
    ],
    messages: coalesceAdjacentAssistantToolCalls(normalizedMessages.messages),
    tools: normalizeTools(request.tools as Array<{ name: string; description?: string; input_schema: unknown }> | undefined),
    toolChoice: normalizeToolChoice(request.tool_choice as { type: 'auto' | 'any' } | { type: 'tool'; name: string } | undefined),
    output: {
      temperature: request.temperature,
      maxOutputTokens: request.max_tokens,
      stop: request.stop_sequences,
    },
    stream: request.stream ?? false,
    metadata: request.metadata,
    extensions: {
      anthropic: {
        ingressProtocol: 'messages',
      },
    },
  }
}
