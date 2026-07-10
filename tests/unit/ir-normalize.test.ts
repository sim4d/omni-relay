import { describe, expect, it } from 'vitest'
import { coalesceAdjacentAssistantToolCalls, coalesceAdjacentToolMessages } from '../../src/core/ir-normalize'
import type { NormalizedMessage } from '../../src/core/ir'

function assistantToolCall(id: string, name = 'exec'): NormalizedMessage {
  return { role: 'assistant', content: [{ type: 'tool_call', id, name, argumentsJson: '{}' }] }
}

function assistantText(text: string): NormalizedMessage {
  return { role: 'assistant', content: [{ type: 'text', text }] }
}

function toolResult(toolCallId: string, result = 'ok'): NormalizedMessage {
  return { role: 'tool', content: [{ type: 'tool_result', toolCallId, result }] }
}

function userText(text: string): NormalizedMessage {
  return { role: 'user', content: [{ type: 'text', text }] }
}

describe('coalesceAdjacentAssistantToolCalls', () => {
  it('merges consecutive assistant tool_call-only messages into one', () => {
    const messages: NormalizedMessage[] = [
      userText('hello'),
      assistantToolCall('call_A'),
      assistantToolCall('call_B'),
      toolResult('call_A'),
      toolResult('call_B'),
    ]

    const result = coalesceAdjacentAssistantToolCalls(messages)

    // Only assistant tool_calls are merged; tool messages stay separate
    expect(result).toHaveLength(4)
    expect(result[1].role).toBe('assistant')
    expect(result[1].content).toHaveLength(2)
    expect(result[1].content[0]).toMatchObject({ type: 'tool_call', id: 'call_A' })
    expect(result[1].content[1]).toMatchObject({ type: 'tool_call', id: 'call_B' })
  })

  it('does NOT coalesce tool messages (needed separate for OpenAI Chat)', () => {
    const messages: NormalizedMessage[] = [
      assistantToolCall('call_A'),
      toolResult('call_A'),
      toolResult('call_B'),
    ]

    const result = coalesceAdjacentAssistantToolCalls(messages)

    // Tool messages stay separate
    expect(result).toHaveLength(3)
    expect(result[1]).toMatchObject({ role: 'tool' })
    expect(result[2]).toMatchObject({ role: 'tool' })
  })

  it('preserves assistant messages with text content (mixed)', () => {
    const messages: NormalizedMessage[] = [
      assistantText('thinking...'),
      assistantToolCall('call_A'),
    ]

    const result = coalesceAdjacentAssistantToolCalls(messages)

    expect(result).toHaveLength(2)
    expect(result[0].content[0]).toMatchObject({ type: 'text', text: 'thinking...' })
    expect(result[1].content[0]).toMatchObject({ type: 'tool_call', id: 'call_A' })
  })

  it('is idempotent', () => {
    const messages: NormalizedMessage[] = [
      assistantToolCall('call_A'),
      assistantToolCall('call_B'),
    ]
    const once = coalesceAdjacentAssistantToolCalls(messages)
    const twice = coalesceAdjacentAssistantToolCalls(once)
    expect(twice).toEqual(once)
  })

  it('handles empty and single-message arrays', () => {
    expect(coalesceAdjacentAssistantToolCalls([])).toEqual([])
    expect(coalesceAdjacentAssistantToolCalls([userText('hi')])).toHaveLength(1)
  })

  it('returns a fresh array with fresh content arrays (single message)', () => {
    const input: NormalizedMessage[] = [userText('hi')]
    const result = coalesceAdjacentAssistantToolCalls(input)
    // Outer array must not be the same reference
    expect(result).not.toBe(input)
    // Inner content array must also not be aliased
    expect(result[0].content).not.toBe(input[0].content)
    expect(result).toEqual(input)
  })

  it('returns a fresh array with fresh content arrays (empty)', () => {
    const input: NormalizedMessage[] = []
    const result = coalesceAdjacentAssistantToolCalls(input)
    expect(result).not.toBe(input)
    expect(result).toEqual([])
  })

  it('preserves the name field when coalescing', () => {
    const messages: NormalizedMessage[] = [
      { role: 'user', name: 'alice', content: [{ type: 'text', text: 'hi' }] },
    ]
    const result = coalesceAdjacentAssistantToolCalls(messages)
    expect(result[0].name).toBe('alice')
  })

  it('preserves order when interspersed with other messages', () => {
    const messages: NormalizedMessage[] = [
      userText('first'),
      assistantToolCall('call_A'),
      assistantToolCall('call_B'),
      toolResult('call_A'),
      toolResult('call_B'),
      userText('second'),
      assistantToolCall('call_C'),
      toolResult('call_C'),
    ]

    const result = coalesceAdjacentAssistantToolCalls(messages)

    // Only assistant tool_calls merged; tool messages stay separate
    expect(result).toHaveLength(7)
    expect(result[1].content).toHaveLength(2) // merged A+B
    expect(result[2].role).toBe('tool')
    expect(result[5].content).toHaveLength(1) // single C
  })
})

describe('coalesceAdjacentToolMessages', () => {
  it('merges consecutive assistant tool_calls AND consecutive tool results', () => {
    const messages: NormalizedMessage[] = [
      assistantToolCall('call_A'),
      assistantToolCall('call_B'),
      toolResult('call_A'),
      toolResult('call_B'),
    ]

    const result = coalesceAdjacentToolMessages(messages)

    expect(result).toHaveLength(2)
    expect(result[0].role).toBe('assistant')
    expect(result[0].content).toHaveLength(2)
    expect(result[1].role).toBe('tool')
    expect(result[1].content).toHaveLength(2)
  })

  it('does not merge tool messages separated by other messages', () => {
    const messages: NormalizedMessage[] = [
      toolResult('call_A'),
      userText('interrupt'),
      toolResult('call_B'),
    ]

    const result = coalesceAdjacentToolMessages(messages)

    expect(result).toHaveLength(3)
  })

  it('is idempotent', () => {
    const messages: NormalizedMessage[] = [
      assistantToolCall('call_A'),
      assistantToolCall('call_B'),
      toolResult('call_A'),
      toolResult('call_B'),
    ]
    const once = coalesceAdjacentToolMessages(messages)
    const twice = coalesceAdjacentToolMessages(once)
    expect(twice).toEqual(once)
  })
})
