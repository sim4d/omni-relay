import { coalesceAdjacentToolMessages } from '../../core/ir-normalize'
import type { CacheControlMarker, ContentBlock, NormalizedMessage, NormalizedRequest } from '../../core/ir'
import { blockToAnthropicContent } from '../../core/content'
import { toAnthropicThinkingWithBudget } from '../../core/reasoning'

function parseArguments(argumentsJson: string): unknown {
  try {
    return JSON.parse(argumentsJson)
  } catch {
    return argumentsJson
  }
}

function renderCacheControl(cc: CacheControlMarker | undefined): Record<string, unknown> | undefined {
  if (!cc) return undefined
  return cc.ttl ? { cache_control: { type: 'ephemeral', ttl: cc.ttl } } : { cache_control: { type: 'ephemeral' } }
}

function blocksToAnthropicContent(blocks: ContentBlock[]): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = []
  for (const block of blocks) {
    if (block.type === 'text') {
      const out: Record<string, unknown> = { type: 'text', text: block.text }
      const cc = renderCacheControl(block.cacheControl)
      if (cc) Object.assign(out, cc)
      results.push(out)
      continue
    }

    if (block.type === 'reasoning') {
      results.push({
        type: 'thinking',
        thinking: block.text,
        ...(block.signature ? { signature: block.signature } : {}),
      })
      continue
    }

    if (block.type === 'tool_call') {
      results.push({
        type: 'tool_use',
        // Use the correlation id (call_id) when distinct from the item id, so
        // tool_result.tool_use_id (which references toolCallId) matches. See the
        // matching fix in the OpenAI Chat request mapper.
        id: block.callId ?? block.id,
        name: block.name,
        input: parseArguments(block.argumentsJson),
      })
      continue
    }

    if (block.type === 'tool_result') {
      // Prefer structured content if present; otherwise the flat string. If the
      // structured content rendered to nothing (all blocks were untranslatable,
      // e.g. reasoning-only), fall back to the flat string so the tool output is
      // never dropped.
      const rendered = block.content && block.content.length > 0 ? blocksToAnthropicContent(block.content) : undefined
      const content = rendered && rendered.length > 0 ? rendered : block.result
      results.push({
        type: 'tool_result',
        tool_use_id: block.toolCallId,
        content,
        is_error: block.isError,
      })
      continue
    }

    if (block.type === 'provider_extension') {
      // Same-provider Anthropic native blocks (e.g. redacted_thinking).
      results.push(block.payload as Record<string, unknown>)
      continue
    }

    const mediaBlock = blockToAnthropicContent(block)
    if (mediaBlock) results.push(mediaBlock)
  }
  return results
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
    // If any text block carries a cache_control marker we must keep the array
    // form — collapsing to a string would drop the cache breakpoint.
    const hasCacheControl = instructions.some(
      (block): block is Extract<ContentBlock, { type: 'text' }> =>
        block.type === 'text' && block.cacheControl !== undefined,
    )
    if (hasCacheControl) {
      return blocksToAnthropicContent(instructions)
    }
    return instructions
      .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
  }

  return blocksToAnthropicContent(instructions) as Array<Record<string, unknown>>
}

export function mapNormalizedRequestToAnthropicMessagesRequest(request: NormalizedRequest) {
  const messages = coalesceAdjacentToolMessages(request.messages)
  const thinking = toAnthropicThinkingWithBudget(request.reasoning)
  const anthropicExtensions = (request.extensions?.anthropic ?? {}) as Record<string, unknown>
  const resolvedThinking =
    thinking ?? (anthropicExtensions.thinking !== undefined ? anthropicExtensions.thinking : undefined)

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
    top_p: request.output?.topP,
    stop_sequences: request.output?.stop,
    metadata: request.metadata,
    stream: request.stream,
    ...(resolvedThinking !== undefined ? { thinking: resolvedThinking } : {}),
  }
}
