import { describe, expect, it } from 'vitest'
import { parseOpenAIResponsesRequest } from '../../src/protocols/openai-responses/parse'
import { mapNormalizedRequestToOpenAIChatRequest } from '../../src/providers/openai/map-request'

describe('parallel tool calls: OpenAI Responses → OpenAI Chat egress', () => {
  it('produces one assistant message with tool_calls[] and separate tool messages', () => {
    const normalized = parseOpenAIResponsesRequest({
      model: 'MiniMax-M3',
      input: [
        { role: 'user', content: [{ type: 'input_text', text: 'do two things' }] },
        { type: 'function_call', name: 'read_mcp_resource', arguments: '{}', call_id: 'call_A' },
        { type: 'function_call', name: 'exec_command', arguments: '{}', call_id: 'call_B' },
        { type: 'function_call_output', call_id: 'call_A', output: 'fail' },
        { type: 'function_call_output', call_id: 'call_B', output: 'ok' },
      ],
    })

    const chatReq = mapNormalizedRequestToOpenAIChatRequest(normalized)
    const messages = chatReq.messages as Array<Record<string, unknown>>

    // system-less: user, assistant(tool_calls A+B), tool(A), tool(B)
    expect(messages).toHaveLength(4)

    // One assistant with tool_calls array of length 2
    const assistantMsg = messages[1]
    expect(assistantMsg.role).toBe('assistant')
    const toolCalls = assistantMsg.tool_calls as Array<Record<string, unknown>>
    expect(toolCalls).toHaveLength(2)
    expect(toolCalls[0].id).toBe('call_A')
    expect(toolCalls[1].id).toBe('call_B')

    // Two separate tool messages (NOT coalesced — Chat requires separate)
    expect(messages[2].role).toBe('tool')
    expect(messages[2].tool_call_id).toBe('call_A')
    expect(messages[3].role).toBe('tool')
    expect(messages[3].tool_call_id).toBe('call_B')
  })
})
