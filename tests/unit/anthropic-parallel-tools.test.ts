import { describe, expect, it } from 'vitest'
import { parseOpenAIResponsesRequest } from '../../src/protocols/openai-responses/parse'
import { mapNormalizedRequestToAnthropicMessagesRequest } from '../../src/providers/anthropic/map-request'

describe('parallel tool calls: OpenAI Responses → Anthropic Messages', () => {
  it('groups parallel function_calls into one assistant message and tool_results into one user message', () => {
    const normalized = parseOpenAIResponsesRequest({
      model: 'kimi-k2.7-code',
      input: [
        { role: 'user', content: [{ type: 'input_text', text: 'do two things' }] },
        { role: 'assistant', content: [{ type: 'output_text', text: 'Doing.' }] },
        { type: 'function_call', name: 'read_mcp_resource', arguments: '{}', call_id: 'call_A' },
        { type: 'function_call', name: 'exec_command', arguments: '{}', call_id: 'call_B' },
        { type: 'function_call_output', call_id: 'call_A', output: 'fail' },
        { type: 'function_call_output', call_id: 'call_B', output: 'ok' },
      ],
    })

    const anthropicReq = mapNormalizedRequestToAnthropicMessagesRequest(normalized)
    const messages = anthropicReq.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>

    // Should be: user, assistant(text), assistant(tool_use A + tool_use B), user(tool_result A + tool_result B)
    expect(messages).toHaveLength(4)

    // Message 2: one assistant with two tool_use blocks
    const assistantToolMsg = messages[2]
    expect(assistantToolMsg.role).toBe('assistant')
    const toolUses = assistantToolMsg.content.filter((b) => b.type === 'tool_use')
    expect(toolUses).toHaveLength(2)
    expect(toolUses[0].id).toBe('call_A')
    expect(toolUses[1].id).toBe('call_B')

    // Message 3: one user with two tool_result blocks
    const userToolResultMsg = messages[3]
    expect(userToolResultMsg.role).toBe('user')
    const toolResults = userToolResultMsg.content.filter((b) => b.type === 'tool_result')
    expect(toolResults).toHaveLength(2)
    expect(toolResults[0].tool_use_id).toBe('call_A')
    expect(toolResults[1].tool_use_id).toBe('call_B')
  })

  it('handles three parallel tool calls', () => {
    const normalized = parseOpenAIResponsesRequest({
      model: 'kimi-k2.7-code',
      input: [
        { role: 'user', content: [{ type: 'input_text', text: 'do three things' }] },
        { type: 'function_call', name: 'tool_a', arguments: '{}', call_id: 'a' },
        { type: 'function_call', name: 'tool_b', arguments: '{}', call_id: 'b' },
        { type: 'function_call', name: 'tool_c', arguments: '{}', call_id: 'c' },
        { type: 'function_call_output', call_id: 'a', output: '1' },
        { type: 'function_call_output', call_id: 'b', output: '2' },
        { type: 'function_call_output', call_id: 'c', output: '3' },
      ],
    })

    const anthropicReq = mapNormalizedRequestToAnthropicMessagesRequest(normalized)
    const messages = anthropicReq.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>

    // user, assistant(3 tool_uses), user(3 tool_results)
    expect(messages).toHaveLength(3)
    expect(messages[1].content.filter((b) => b.type === 'tool_use')).toHaveLength(3)
    expect(messages[2].content.filter((b) => b.type === 'tool_result')).toHaveLength(3)
  })
})
