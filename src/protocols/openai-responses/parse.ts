import { ValidationError } from '../../errors'
import type { ContentBlock, NormalizedMessage, NormalizedRequest, NormalizedTool, ToolChoice } from '../../core/ir'
import { openAIImagePartToBlock, openAIFilePartToBlock } from '../../core/content'
import { fromOpenAIReasoningEffort } from '../../core/reasoning'
import { coalesceAdjacentAssistantToolCalls } from '../../core/ir-normalize'
import { openAIResponsesRequestSchema } from './schema'

function textBlock(text: string): ContentBlock {
  return { type: 'text', text }
}

function parseInputContentParts(content: unknown[]): ContentBlock[] {
  return content.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return [{ type: 'provider_extension', provider: 'openai', name: 'input_item', payload: item } satisfies ContentBlock]
    }

    const record = item as Record<string, unknown>
    if ((record.type === 'input_text' || record.type === 'output_text' || record.type === 'text') && typeof record.text === 'string') {
      return [textBlock(record.text)]
    }

    if (record.type === 'input_image' || record.type === 'image' || record.type === 'image_url') {
      const block = openAIImagePartToBlock(record)
      // Skip malformed image parts rather than wrapping as provider_extension
      // (which would 422 on cross-provider routes). See openai-chat/parse.ts.
      if (block) return [block]
      return []
    }

    if (record.type === 'input_file' || record.type === 'file') {
      const block = openAIFilePartToBlock(record)
      if (block) return [block]
      return []
    }

    return [{ type: 'provider_extension', provider: 'openai', name: String(record.type ?? 'input_item'), payload: item } satisfies ContentBlock]
  })
}

function parseContentArray(content: unknown[]): ContentBlock[] {
  return parseInputContentParts(content)
}

/**
 * Resolve the tool-call id and call_id from a Responses function_call item.
 * `call_id` is the correlation id the client echoes back in
 * `function_call_output`; `id` is the item id. When only one is present we use
 * it for both, preserving whichever the upstream actually set.
 */
function resolveCallIds(record: Record<string, unknown>): { id: string; callId: string | undefined } {
  const callId = typeof record.call_id === 'string' ? record.call_id : undefined
  const id = typeof record.id === 'string' ? record.id : callId ?? crypto.randomUUID()
  return { id, callId }
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
      const { id, callId } = resolveCallIds(item)
      messages.push({
        role: 'assistant',
        content: [{
          type: 'tool_call',
          id,
          callId,
          name: item.name,
          argumentsJson:
            typeof item.arguments === 'string'
              ? item.arguments
              : JSON.stringify(item.arguments ?? {}),
        }],
      })
      continue
    }

    if ((item.type === 'function_call_output' || item.type === 'tool_result') && typeof item.call_id === 'string') {
      messages.push({
        role: 'tool',
        content: [{
          type: 'tool_result',
          toolCallId: item.call_id,
          result: typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? null),
        }],
      })
      continue
    }

    // Reasoning items (type: 'reasoning') represent the model's prior
    // thinking context. They have no Chat Completions equivalent and
    // producing an empty user message from them causes upstream 400s
    // (e.g. z.ai code 1210 on content:null). Skip them on the Chat wire.
    if (item.type === 'reasoning') {
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

  return { instructions, messages: coalesceAdjacentAssistantToolCalls(messages) }
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

/**
 * Normalize the Responses `reasoning` object into the IR reasoning config.
 * Supports `{ effort: '...' }`, `{ summary: '...' }`, and `{ exclude: true }`.
 */
function normalizeResponsesReasoning(reasoning: unknown) {
  if (!reasoning || typeof reasoning !== 'object') return undefined
  const record = reasoning as Record<string, unknown>
  if (record.exclude === true || record.reasoning_effort === 'none') return { enabled: false }
  const effortRaw = record.effort ?? record.reasoning_effort
  const cfg = fromOpenAIReasoningEffort(effortRaw)
  if (cfg) return cfg
  // `reasoning: { summary: 'auto' }` with no effort → leave default (auto).
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
    parallel_tool_calls,
    stream,
    temperature,
    top_p,
    reasoning,
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
    reasoning: normalizeResponsesReasoning(reasoning),
    parallelToolCalls: typeof parallel_tool_calls === 'boolean' ? parallel_tool_calls : undefined,
    output: {
      temperature,
      topP: top_p,
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
