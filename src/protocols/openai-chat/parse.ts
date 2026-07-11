import { ValidationError } from '../../errors'
import type {
  ContentBlock,
  NormalizedMessage,
  NormalizedRequest,
  NormalizedTool,
  ToolChoice,
  ToolResultContentBlock,
} from '../../core/ir'
import { openAIImagePartToBlock, openAIFilePartToBlock, blockToOpenAIChatContentPart } from '../../core/content'
import { coalesceAdjacentAssistantToolCalls } from '../../core/ir-normalize'
import { fromOpenAIReasoningEffort } from '../../core/reasoning'
import { openAIChatRequestSchema, type OpenAIChatRequest } from './schema'

function toTextBlock(text: string): ContentBlock {
  return { type: 'text', text }
}

function parseContentParts(parts: unknown[]): ContentBlock[] {
  return parts.flatMap((part) => {
    if (!part || typeof part !== 'object') {
      return [{ type: 'provider_extension', provider: 'openai', name: 'content_part', payload: part } satisfies ContentBlock]
    }

    const record = part as Record<string, unknown>
    if (record.type === 'text' && typeof record.text === 'string') {
      return [toTextBlock(record.text)]
    }

    if (record.type === 'input_text' && typeof record.text === 'string') {
      return [toTextBlock(record.text)]
    }

    if (record.type === 'image_url' || record.type === 'input_image' || record.type === 'image') {
      const block = openAIImagePartToBlock(record)
      // A malformed image part (empty url, no data) cannot be translated and
      // has no useful provider-extension form. Skip it rather than wrapping it
      // as a provider_extension, which would trip the cross-provider feature
      // gate (422) on an Anthropic-selected route.
      if (block) return [block]
      return []
    }

    if (record.type === 'file' || record.type === 'input_file') {
      const block = openAIFilePartToBlock(record)
      if (block) return [block]
      return []
    }

    return [{ type: 'provider_extension', provider: 'openai', name: String(record.type ?? 'content_part'), payload: part } satisfies ContentBlock]
  })
}

function parseMessageContent(message: OpenAIChatRequest['messages'][number]): ContentBlock[] {
  if (message.role === 'tool') {
    if (!message.tool_call_id) {
      throw new ValidationError('Tool messages must include tool_call_id')
    }

    const toolResult: ToolResultContentBlock = {
      type: 'tool_result',
      toolCallId: message.tool_call_id,
      result:
        typeof message.content === 'string'
          ? message.content
          : JSON.stringify(message.content ?? null),
    }

    return [toolResult]
  }

  const contentBlocks: ContentBlock[] =
    typeof message.content === 'string'
      ? [toTextBlock(message.content)]
      : Array.isArray(message.content)
        ? parseContentParts(message.content)
        : []

  const toolCallBlocks = (message.tool_calls ?? []).map((toolCall) => ({
    type: 'tool_call' as const,
    id: toolCall.id,
    name: toolCall.function.name,
    argumentsJson: toolCall.function.arguments,
  }))

  return [...contentBlocks, ...toolCallBlocks]
}

function normalizeToolChoice(toolChoice: OpenAIChatRequest['tool_choice']): ToolChoice | undefined {
  if (!toolChoice) return undefined
  if (toolChoice === 'auto' || toolChoice === 'none' || toolChoice === 'required') {
    return { type: toolChoice }
  }

  return {
    type: 'tool',
    name: toolChoice.function.name,
  }
}

function normalizeTools(tools: OpenAIChatRequest['tools']): NormalizedTool[] | undefined {
  if (!tools?.length) return undefined
  return tools.map((tool) => ({
    type: 'function',
    name: tool.function.name,
    description: tool.function.description,
    inputSchema: tool.function.parameters,
  }))
}

function normalizeMessages(messages: OpenAIChatRequest['messages']): {
  instructions: ContentBlock[]
  messages: NormalizedMessage[]
} {
  const instructions: ContentBlock[] = []
  const normalizedMessages: NormalizedMessage[] = []

  for (const message of messages) {
    const parsedContent = parseMessageContent(message)

    if (message.role === 'system' || message.role === 'developer') {
      instructions.push(...parsedContent)
      continue
    }

    normalizedMessages.push({
      role: message.role,
      name: message.name,
      content: parsedContent,
    })
  }

  return { instructions, messages: coalesceAdjacentAssistantToolCalls(normalizedMessages) }
}

export function parseOpenAIChatRequest(input: unknown): NormalizedRequest {
  const parsed = openAIChatRequestSchema.safeParse(input)

  if (!parsed.success) {
    throw new ValidationError('OpenAI Chat request validation failed', parsed.error.flatten())
  }

  const request = parsed.data
  const {
    model,
    providerHint,
    messages,
    tools,
    tool_choice,
    parallel_tool_calls,
    stream,
    stream_options,
    temperature,
    top_p,
    reasoning_effort,
    max_completion_tokens,
    max_tokens,
    stop,
    response_format,
    ...rest
  } = request
  const normalizedMessages = normalizeMessages(messages)

  return {
    targetModel: model,
    providerHint,
    instructions: normalizedMessages.instructions,
    messages: normalizedMessages.messages,
    tools: normalizeTools(tools),
    toolChoice: normalizeToolChoice(tool_choice),
    reasoning: fromOpenAIReasoningEffort(reasoning_effort),
    parallelToolCalls: typeof parallel_tool_calls === 'boolean' ? parallel_tool_calls : undefined,
    output: {
      temperature,
      topP: top_p,
      maxOutputTokens: max_completion_tokens ?? max_tokens,
      stop: typeof stop === 'string' ? [stop] : stop,
    },
    stream: stream ?? false,
    streamIncludeUsage: stream_options?.include_usage === true,
    extensions: {
      openai: {
        ingressProtocol: 'chat.completions',
        ...(response_format !== undefined ? { response_format } : {}),
        ...(Object.keys(rest).length > 0 ? { unmappedRequestFields: rest } : {}),
      },
    },
  }
}

export { blockToOpenAIChatContentPart }
