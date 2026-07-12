import type { ContentBlock, NormalizedMessage, NormalizedRequest } from '../../core/ir'
import { blockToOpenAIChatContentPart } from '../../core/content'
import { toOpenAIReasoningEffort } from '../../core/reasoning'

function stringifyTextBlocks(blocks: ContentBlock[]): string | null {
  const text = blocks
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('')

  return text.length > 0 ? text : null
}

/**
 * Render normalized content blocks into an OpenAI Chat `content` value.
 * Returns string for text-only, array for multimodal, or null when empty.
 */
function toChatContentValue(blocks: ContentBlock[]): string | Array<Record<string, unknown>> | null {
  const parts: Array<Record<string, unknown>> = []
  let hasNonText = false

  for (const block of blocks) {
    if (block.type === 'text') {
      parts.push({ type: 'text', text: block.text })
      continue
    }
    const part = blockToOpenAIChatContentPart(block)
    if (part) {
      parts.push(part)
      hasNonText = true
      continue
    }
    // Untranslatable block (e.g. reasoning) — skip on the Chat path.
  }

  if (parts.length === 0) return null
  if (!hasNonText && parts.every((p) => p.type === 'text')) {
    return parts.map((p) => p.text as string).join('')
  }
  return parts
}

function toToolResultContent(block: Extract<ContentBlock, { type: 'tool_result' }>): string | Array<Record<string, unknown>> | null {
  if (block.content && block.content.length > 0) {
    const value = toChatContentValue(block.content)
    if (value !== null) return value
  }
  return block.result
}

function toChatMessage(message: NormalizedMessage) {
  if (message.role === 'tool') {
    const toolResult = message.content.find((block): block is Extract<ContentBlock, { type: 'tool_result' }> => block.type === 'tool_result')
    const content = toolResult ? toToolResultContent(toolResult) : ''
    return {
      role: 'tool',
      content,
      tool_call_id: toolResult?.toolCallId,
    }
  }

  const contentValue = toChatContentValue(message.content)
  const toolCalls = message.content
    .filter((block): block is Extract<ContentBlock, { type: 'tool_call' }> => block.type === 'tool_call')
    .map((block) => ({
      // Emit the correlation id (call_id) when the source distinguished it from
      // the item id (OpenAI Responses function_call). The matching tool_result
      // references toolCallId, so the single Chat id must be the correlation id
      // or upstreams 400 on the mismatch.
      id: block.callId ?? block.id,
      type: 'function' as const,
      function: {
        name: block.name,
        arguments: block.argumentsJson,
      },
    }))

  // Assistant messages may carry reasoning text; OpenAI Chat surfaces this as
  // `reasoning_content` on the message (consumed by some clients).
  const reasoningText = message.content
    .filter((block): block is Extract<ContentBlock, { type: 'reasoning' }> => block.type === 'reasoning')
    .map((block) => block.text)
    .join('')

  return {
    role: message.role,
    content: contentValue,
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    ...(reasoningText.length > 0 ? { reasoning_content: reasoningText } : {}),
  }
}

export function mapNormalizedRequestToOpenAIChatRequest(request: NormalizedRequest) {
  const instructionText = stringifyTextBlocks(request.instructions)
  const openAIExtensions = (request.extensions?.openai ?? {}) as Record<string, unknown>
  const reasoningEffort = toOpenAIReasoningEffort(request.reasoning)
  const unmappedRequestFields =
    openAIExtensions.unmappedRequestFields && typeof openAIExtensions.unmappedRequestFields === 'object'
      ? openAIExtensions.unmappedRequestFields as Record<string, unknown>
      : undefined

  const body = {
    model: request.targetModel,
    messages: [
      ...(instructionText ? [{ role: 'system', content: instructionText }] : []),
      ...request.messages
        .map(toChatMessage)
        // Filter out messages that are completely empty after translation
        // (e.g. reasoning-only items that have no Chat representation).
        // Sending content:null user messages causes 400s on strict upstreams.
        .filter((msg) => msg.content !== null
        || (msg as Record<string, unknown>).tool_calls !== undefined
        || (msg as Record<string, unknown>).reasoning_content !== undefined),
    ],
    tools: request.tools?.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema ?? { type: 'object', properties: {} },
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
    top_p: request.output?.topP,
    max_completion_tokens: request.output?.maxOutputTokens,
    stop:
      request.output?.stop && request.output.stop.length === 1
        ? request.output.stop[0]
        : request.output?.stop,
    ...(reasoningEffort !== undefined ? { reasoning_effort: reasoningEffort } : {}),
    ...(typeof request.parallelToolCalls === 'boolean' ? { parallel_tool_calls: request.parallelToolCalls } : {}),
    ...(openAIExtensions.response_format !== undefined ? { response_format: openAIExtensions.response_format } : {}),
  }

  // Same-wire passthrough of Chat-native fields (user, seed, logprobs,
  // frequency_penalty, presence_penalty, etc.) that we don't model
  // explicitly. Only forwarded when the request also arrived on the Chat wire
  // (ingressProtocol 'chat.completions'). Fields from a Responses or Messages
  // ingress (store, include, prompt_cache_key, service_tier, etc.) are
  // dropped because they have no Chat Completions equivalent and cause
  // upstream 400s on strict OpenAI-compatible providers (e.g. z.ai code 1210).
  const ingressProtocol = typeof openAIExtensions.ingressProtocol === 'string' ? openAIExtensions.ingressProtocol : undefined
  if (unmappedRequestFields && ingressProtocol === 'chat.completions') {
    return { ...unmappedRequestFields, ...body }
  }
  return body
}
