import type { ContentBlock, NormalizedMessage } from './ir'

/**
 * Coalesce consecutive `assistant` messages that carry only `tool_call` blocks
 * into a single `assistant` message.
 *
 * This is safe for ALL egress paths:
 * - Anthropic: multiple `tool_use` blocks in one assistant message is the
 *   correct representation; splitting them causes "tool_calls must be followed
 *   by tool messages" errors.
 * - OpenAI Chat: multiple entries in `tool_calls[]` within one assistant
 *   message is the correct representation; splitting them causes "tool call
 *   result does not follow tool call" errors on strict upstreams (e.g. MiniMax).
 * - OpenAI Responses: function_call items are top-level; grouping them in one
 *   assistant message is harmless.
 *
 * This does NOT coalesce `tool` messages because different egress paths have
 * different requirements for tool results:
 * - Anthropic wants all tool_results in ONE user message
 * - OpenAI Chat wants each tool_result as a SEPARATE tool message
 *
 * Always returns a fresh outer array. Content arrays are shallow-copied
 * (individual ContentBlock objects are shared by reference with the input —
 * no current caller mutates them in place).
 */
export function coalesceAdjacentAssistantToolCalls(messages: NormalizedMessage[]): NormalizedMessage[] {
  const result: NormalizedMessage[] = []
  let prevWasToolCallOnly = false

  for (const message of messages) {
    const previous = result[result.length - 1]
    const currentIsToolCallOnly = isToolCallOnly(message.content)

    if (
      previous
      && previous.role === 'assistant'
      && message.role === 'assistant'
      && prevWasToolCallOnly
      && currentIsToolCallOnly
    ) {
      previous.content.push(...message.content)
      continue
    }

    result.push({ ...message, content: [...message.content] })
    prevWasToolCallOnly = currentIsToolCallOnly
  }

  return result
}

/**
 * Coalesce BOTH consecutive assistant tool_call-only messages AND consecutive
 * `tool` messages into single messages.
 *
 * This is intended for the Anthropic egress path where all tool_results for
 * one assistant turn must appear in a single user message.  Using it on the
 * OpenAI Chat path would be incorrect (Chat requires separate tool messages).
 *
 * Idempotent: running twice is a no-op.
 */
export function coalesceAdjacentToolMessages(messages: NormalizedMessage[]): NormalizedMessage[] {
  const result: NormalizedMessage[] = []
  let prevKey: 'tool_call' | 'tool_result' | null = null

  for (const message of messages) {
    const previous = result[result.length - 1]
    const currentKey = messageKey(message)

    if (previous && previous.role === message.role && prevKey !== null && currentKey !== null && prevKey === currentKey) {
      previous.content.push(...message.content)
      continue
    }

    result.push({ ...message, content: [...message.content] })
    prevKey = currentKey
  }

  return result
}

function messageKey(message: NormalizedMessage): 'tool_call' | 'tool_result' | null {
  if (message.role === 'assistant' && isToolCallOnly(message.content)) return 'tool_call'
  if (message.role === 'tool' && isToolResultOnly(message.content)) return 'tool_result'
  return null
}

function isToolCallOnly(blocks: ContentBlock[]): boolean {
  return blocks.length > 0 && blocks.every((block) => block.type === 'tool_call')
}

function isToolResultOnly(blocks: ContentBlock[]): boolean {
  return blocks.length > 0 && blocks.every((block) => block.type === 'tool_result')
}
