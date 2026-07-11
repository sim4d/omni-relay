import { ValidationError } from '../../errors'
import type { ContentBlock, NormalizedMessage, NormalizedRequest, NormalizedTool, ToolChoice, ToolResultContentBlock } from '../../core/ir'
import { anthropicMediaBlockToNormalized, parseCacheControl } from '../../core/content'
import { fromAnthropicThinking } from '../../core/reasoning'
import { coalesceAdjacentAssistantToolCalls } from '../../core/ir-normalize'
import { anthropicMessagesRequestSchema } from './schema'

function textBlock(text: string): ContentBlock {
  return { type: 'text', text }
}

function parseContentBlocks(content: string | Array<Record<string, unknown>>, depth = 0): ContentBlock[] {
  if (typeof content === 'string') {
    return [textBlock(content)]
  }

  // Guard against deeply-nested tool_result.content arrays (a request-scoped
  // DoS via stack overflow). Anthropic tool results are shallow in practice;
  // cap recursion well below V8's stack limit.
  if (depth > 16) {
    return []
  }

  return content.flatMap((block) => {
    if (block.type === 'text' && typeof block.text === 'string') {
      const text: Extract<ContentBlock, { type: 'text' }> = { type: 'text', text: block.text }
      const cacheControl = parseCacheControl(block)
      if (cacheControl) text.cacheControl = cacheControl
      return [text]
    }

    if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
      return [{
        type: 'tool_call',
        id: block.id,
        callId: typeof block.call_id === 'string' ? block.call_id : undefined,
        name: block.name,
        argumentsJson:
          typeof block.input === 'string'
            ? block.input
            : JSON.stringify(block.input ?? {}),
      } satisfies ContentBlock]
    }

    if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
      const structured = Array.isArray(block.content)
        ? parseContentBlocks(block.content as Array<Record<string, unknown>>, depth + 1)
        : undefined
      const flat =
        typeof block.content === 'string'
          ? block.content
          : JSON.stringify(block.content ?? null)
      const result: ToolResultContentBlock = {
        type: 'tool_result',
        toolCallId: block.tool_use_id,
        result: flat,
        isError: typeof block.is_error === 'boolean' ? block.is_error : undefined,
      }
      if (structured && structured.length > 0) {
        result.content = structured
        // If the structured content is a single text block, prefer its text as
        // the flat result so string-only consumers get the natural value.
        if (structured.length === 1 && structured[0].type === 'text') {
          result.result = structured[0].text
        }
      }
      return [result satisfies ContentBlock]
    }

    if (block.type === 'thinking' && typeof block.thinking === 'string') {
      return [{
        type: 'reasoning',
        text: block.thinking,
        signature: typeof block.signature === 'string' ? block.signature : undefined,
      } satisfies ContentBlock]
    }

    if (block.type === 'redacted_thinking' && typeof block.data === 'string') {
      // Preserve the redacted thinking verbatim via a provider extension so the
      // Anthropic same-provider round-trip can echo it back unchanged.
      return [{
        type: 'provider_extension',
        provider: 'anthropic',
        name: 'redacted_thinking',
        payload: block,
      } satisfies ContentBlock]
    }

    const mediaBlock = anthropicMediaBlockToNormalized(block)
    if (mediaBlock) {
      const cacheControl = parseCacheControl(block)
      if (cacheControl && mediaBlock.type !== 'text') {
        // media blocks don't carry cacheControl in the IR; preserve via the
        // text-block field where relevant. For now keep it simple: only text
        // blocks model cacheControl explicitly.
      }
      return [mediaBlock]
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

function normalizeTools(tools: Array<{ name: string; description?: string; input_schema: unknown; cache_control?: unknown }> | undefined): NormalizedTool[] | undefined {
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
  const { thinking, top_p, ...rest } = request
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
    tools: normalizeTools(request.tools as Array<{ name: string; description?: string; input_schema: unknown; cache_control?: unknown }> | undefined),
    toolChoice: normalizeToolChoice(request.tool_choice as { type: 'auto' | 'any' } | { type: 'tool'; name: string } | undefined),
    reasoning: fromAnthropicThinking(thinking),
    output: {
      temperature: request.temperature,
      topP: top_p,
      maxOutputTokens: request.max_tokens,
      stop: request.stop_sequences,
    },
    stream: request.stream ?? false,
    metadata: request.metadata,
    extensions: {
      anthropic: {
        ingressProtocol: 'messages',
        ...(thinking !== undefined ? { thinking } : {}),
        ...(Object.keys(rest).length > 0 ? { unmappedRequestFields: rest } : {}),
      },
    },
  }
}
