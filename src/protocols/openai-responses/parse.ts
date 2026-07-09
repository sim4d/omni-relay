import { ValidationError } from '../../errors'
import type { ContentBlock, NormalizedMessage, NormalizedRequest, NormalizedTool, ToolChoice } from '../../core/ir'
import { openAIResponsesRequestSchema } from './schema'

function textBlock(text: string): ContentBlock {
  return { type: 'text', text }
}

function parseContentArray(content: unknown[]): ContentBlock[] {
  return content.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return [{ type: 'provider_extension', provider: 'openai', name: 'input_item', payload: item } satisfies ContentBlock]
    }

    const record = item as Record<string, unknown>
    if ((record.type === 'input_text' || record.type === 'output_text' || record.type === 'text') && typeof record.text === 'string') {
      return [textBlock(record.text)]
    }

    if ((record.type === 'function_call_output' || record.type === 'tool_result') && typeof record.call_id === 'string') {
      return [{
        type: 'tool_result',
        toolCallId: record.call_id,
        result: typeof record.output === 'string' ? record.output : JSON.stringify(record.output ?? null),
      } satisfies ContentBlock]
    }

    if ((record.type === 'function_call' || record.type === 'tool_call') && typeof record.name === 'string') {
      return [{
        type: 'tool_call',
        id: typeof record.call_id === 'string' ? record.call_id : typeof record.id === 'string' ? record.id : crypto.randomUUID(),
        name: record.name,
        argumentsJson:
          typeof record.arguments === 'string'
            ? record.arguments
            : JSON.stringify(record.arguments ?? {}),
      } satisfies ContentBlock]
    }

    return [{ type: 'provider_extension', provider: 'openai', name: String(record.type ?? 'input_item'), payload: item } satisfies ContentBlock]
  })
}

function parseInput(input: string | Array<Record<string, unknown>>): { instructions: ContentBlock[]; messages: NormalizedMessage[] } {
  if (typeof input === 'string') {
    return {
      instructions: [],
      messages: [{ role: 'user', content: [textBlock(input)] }],
    }
  }

  const instructions: ContentBlock[] = []
  const messages: NormalizedMessage[] = []

  for (const item of input) {
    if ((item.type === 'function_call' || item.type === 'tool_call') && typeof item.name === 'string') {
      messages.push({
        role: 'assistant',
        content: parseContentArray([item]),
      })
      continue
    }

    if ((item.type === 'function_call_output' || item.type === 'tool_result') && typeof item.call_id === 'string') {
      messages.push({
        role: 'tool',
        content: parseContentArray([item]),
      })
      continue
    }

    const role = typeof item.role === 'string' ? item.role : 'user'
    const content =
      typeof item.content === 'string'
        ? [textBlock(item.content)]
        : Array.isArray(item.content)
          ? parseContentArray(item.content)
          : []

    if (role === 'system' || role === 'developer') {
      instructions.push(...content)
      continue
    }

    if (role === 'user' || role === 'assistant' || role === 'tool') {
      messages.push({ role, content })
      continue
    }

    messages.push({
      role: 'user',
      content: [{ type: 'provider_extension', provider: 'openai', name: `role:${role}`, payload: item }],
    })
  }

  return { instructions, messages }
}

function normalizeTools(tools: Array<Record<string, unknown>> | undefined): NormalizedTool[] | undefined {
  if (!tools?.length) return undefined

  const functionTools: NormalizedTool[] = []

  for (const tool of tools) {
    // Any tool with a name is function-shaped and can be translated to any
    // provider's tool format. This covers 'function', 'custom' (Codex CLI),
    // and any other type that carries name + parameters.
    if (typeof tool.name === 'string' && tool.name.length > 0) {
      functionTools.push({
        type: 'function',
        name: String(tool.name),
        description: typeof tool.description === 'string' ? tool.description : undefined,
        inputSchema: tool.parameters,
      })
      continue
    }

    // Tools without a name (e.g. 'web_search') cannot be translated to a
    // function-shaped schema. Silently drop them rather than failing the
    // entire request — the upstream cannot use them cross-provider anyway.
  }

  return functionTools.length > 0 ? functionTools : undefined
}

function normalizeToolChoice(toolChoice: unknown): ToolChoice | undefined {
  if (!toolChoice) return undefined
  if (toolChoice === 'auto' || toolChoice === 'none' || toolChoice === 'required') {
    return { type: toolChoice }
  }

  if (
    typeof toolChoice === 'object'
    && toolChoice
    && 'name' in toolChoice
    && typeof (toolChoice as Record<string, unknown>).name === 'string'
  ) {
    const record = toolChoice as Record<string, unknown>
    return {
      type: 'tool',
      name: record.name as string,
      toolType: record.type === 'function' ? 'function' : undefined,
    }
  }

  return undefined
}

export function parseOpenAIResponsesRequest(input: unknown): NormalizedRequest {
  const parsed = openAIResponsesRequestSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError('OpenAI Responses request validation failed', parsed.error.flatten())
  }

  const request = parsed.data
  const {
    model,
    providerHint,
    input: requestInput,
    instructions: requestInstructions,
    tools,
    tool_choice,
    stream,
    temperature,
    max_output_tokens,
    text,
    metadata,
    ...unmappedRequestFields
  } = request
  const normalizedInput = parseInput(requestInput as string | Array<Record<string, unknown>>)
  const normalizedTools = normalizeTools(tools as Array<Record<string, unknown>> | undefined)

  return {
    targetModel: model,
    providerHint,
    instructions: [
      ...(requestInstructions ? [textBlock(requestInstructions)] : []),
      ...normalizedInput.instructions,
    ],
    messages: normalizedInput.messages,
    tools: normalizedTools,
    toolChoice: normalizeToolChoice(tool_choice),
    output: {
      temperature,
      maxOutputTokens: max_output_tokens,
    },
    stream: stream ?? false,
    metadata,
    extensions: {
      openai: {
        ingressProtocol: 'responses',
        text,
        ...(Object.keys(unmappedRequestFields).length > 0 ? { unmappedRequestFields } : {}),
      },
    },
  }
}
