import type { ContentBlock, NormalizedMessage, NormalizedRequest } from '../../core/ir'

function blocksToInputContent(blocks: ContentBlock[]): unknown[] {
  const items: unknown[] = []
  for (const block of blocks) {
    if (block.type === 'text') {
      items.push({ type: 'input_text', text: block.text })
      continue
    }

    if (block.type === 'image') {
      if (block.data) items.push({ type: 'input_image', media_type: block.mediaType ?? 'image/png', data: block.data })
      else if (block.url) items.push({ type: 'input_image', url: block.url })
      continue
    }

    if (block.type === 'document') {
      if (block.data) items.push({ type: 'input_file', media_type: block.mediaType ?? 'application/pdf', data: block.data })
      else if (block.url) items.push({ type: 'input_file', url: block.url })
      continue
    }

    if (block.type === 'tool_call') {
      items.push({
        type: 'function_call',
        call_id: block.callId ?? block.id,
        id: block.id,
        name: block.name,
        arguments: block.argumentsJson,
      })
      continue
    }

    if (block.type === 'tool_result') {
      items.push({
        type: 'function_call_output',
        call_id: block.toolCallId,
        output: block.result,
      })
      continue
    }

    if (block.type === 'provider_extension') {
      items.push(block.payload)
      continue
    }

    // reasoning blocks have no Responses-input representation; skip.
  }
  return items
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

/**
 * Render the IR reasoning config as a Responses `reasoning` object. Only emits
 * the fields the IR actually carries; we do not invent provider-native extras
 * like `summary` so that a same-provider round-trip stays faithful to what the
 * client sent.
 */
function toResponsesReasoning(request: NormalizedRequest): unknown {
  const config = request.reasoning
  if (!config) return undefined
  if (config.enabled === false) return { exclude: true }
  if (config.effort && config.effort !== 'none' && config.effort !== 'auto') {
    return { effort: config.effort }
  }
  return undefined
}

export function mapNormalizedRequestToOpenAIResponsesRequest(request: NormalizedRequest) {
  const openAIExtensions = request.extensions?.openai ?? {}
  const unmappedRequestFields =
    openAIExtensions.unmappedRequestFields && typeof openAIExtensions.unmappedRequestFields === 'object'
      ? openAIExtensions.unmappedRequestFields as Record<string, unknown>
      : undefined
  const functionTools = request.tools?.map((tool) => ({
    type: 'function' as const,
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema ?? { type: 'object', properties: {} },
  })) ?? []
  const tools = functionTools
  const reasoning = toResponsesReasoning(request)

  // Build the typed body, then layer unmapped same-provider fields on top so
  // they survive a Responses→Responses round-trip without clobbering the
  // fields we model explicitly.
  const body = {
    model: request.targetModel,
    instructions: instructionsToText(request.instructions),
    input: request.messages.map(messageToInputItem),
    tools: tools.length > 0 ? tools : undefined,
    tool_choice:
      request.toolChoice?.type === 'tool'
        ? { type: 'function' as const, name: request.toolChoice.name }
        : request.toolChoice?.type,
    temperature: request.output?.temperature,
    top_p: request.output?.topP,
    max_output_tokens: request.output?.maxOutputTokens,
    metadata: request.metadata,
    stream: request.stream,
    ...(openAIExtensions.text ? { text: openAIExtensions.text } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
    ...(typeof request.parallelToolCalls === 'boolean' ? { parallel_tool_calls: request.parallelToolCalls } : {}),
  }

  if (unmappedRequestFields) {
    return { ...unmappedRequestFields, ...body }
  }
  return body
}
