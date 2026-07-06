import { UnsupportedFeatureError, ValidationError } from '../../errors'
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

function normalizeTools(tools: Array<Record<string, unknown>> | undefined): {
  functionTools?: NormalizedTool[]
  customTools?: Array<Record<string, unknown>>
} {
  if (!tools?.length) return {}

  const functionTools: NormalizedTool[] = []
  const customTools: Array<Record<string, unknown>> = []

  for (const tool of tools) {
    if (tool.type === 'function') {
      functionTools.push({
        type: 'function',
        name: String(tool.name),
        description: typeof tool.description === 'string' ? tool.description : undefined,
        inputSchema: tool.parameters,
      })
      continue
    }

    if (tool.type === 'custom') {
      customTools.push(tool)
      continue
    }

    throw new UnsupportedFeatureError(`OpenAI Responses tool type \"${String(tool.type)}\" is not supported in MVP`)
  }

  return {
    functionTools: functionTools.length > 0 ? functionTools : undefined,
    customTools: customTools.length > 0 ? customTools : undefined,
  }
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
      toolType: record.type === 'custom' ? 'custom' : record.type === 'function' ? 'function' : undefined,
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
    tools: normalizedTools.functionTools,
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
        ...(normalizedTools.customTools ? { customTools: normalizedTools.customTools } : {}),
        ...(Object.keys(unmappedRequestFields).length > 0 ? { unmappedRequestFields } : {}),
      },
    },
  }
}
