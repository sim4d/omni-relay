import { parseOpenAIResponsesRequest } from '../../src/protocols/openai-responses/parse'

describe('parseOpenAIResponsesRequest', () => {
  it('normalizes instructions, user input items, and function tools', () => {
    const normalized = parseOpenAIResponsesRequest({
      model: 'gpt-5.4-nano',
      instructions: 'Be concise.',
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'Hello' }],
        },
      ],
      tools: [
        {
          type: 'function',
          name: 'lookup_weather',
          description: 'Get weather',
          parameters: { type: 'object' },
        },
      ],
      tool_choice: 'auto',
      max_output_tokens: 64,
    })

    expect(normalized.instructions).toEqual([{ type: 'text', text: 'Be concise.' }])
    expect(normalized.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }])
    expect(normalized.tools?.[0]?.name).toBe('lookup_weather')
    expect(normalized.output?.maxOutputTokens).toBe(64)
  })

  it('treats tools with names as function tools and drops nameless tools', () => {
    const normalized = parseOpenAIResponsesRequest({
      model: 'glm-5.2',
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'Hello' }],
        },
      ],
      tools: [
        {
          type: 'custom',
          name: 'codex',
          description: 'Run a Codex-native tool',
          format: { type: 'grammar', syntax: 'lark', definition: 'start: /.+/' },
        },
        {
          type: 'namespace',
          name: 'multi_agent_v1',
          description: 'Tools for sub-agents',
          tools: [{ type: 'function', name: 'spawn_agent', parameters: { type: 'object' } }],
        },
        {
          type: 'web_search',
          external_web_access: false,
        },
      ],
      tool_choice: { type: 'custom', name: 'codex' },
      parallel_tool_calls: false,
      reasoning: { effort: 'high' },
    })

    // Tools with names are normalized to function tools (type is rewritten)
    expect(normalized.tools).toEqual([
      {
        type: 'function',
        name: 'codex',
        description: 'Run a Codex-native tool',
        inputSchema: undefined,
      },
      {
        type: 'function',
        name: 'multi_agent_v1',
        description: 'Tools for sub-agents',
        inputSchema: undefined,
      },
    ])
    // tool_choice for custom tools is normalized to function type
    expect(normalized.toolChoice).toEqual({ type: 'tool', name: 'codex', toolType: undefined })
    // web_search (no name) is silently dropped, not preserved
    expect(normalized.extensions?.openai?.providerNativeTools).toBeUndefined()
    // parallel_tool_calls and reasoning are now modeled fields, not unmapped.
    expect(normalized.parallelToolCalls).toBe(false)
    expect(normalized.reasoning).toEqual({ effort: 'high', enabled: true })
    expect(normalized.extensions?.openai?.unmappedRequestFields).toBeUndefined()
  })

  it('maps top-level function_call and function_call_output items into assistant/tool messages', () => {
    const normalized = parseOpenAIResponsesRequest({
      model: 'glm-5.2',
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'Explain this project' }],
        },
        {
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Let me inspect the repo.' }],
        },
        {
          type: 'function_call',
          name: 'exec_command',
          arguments: '{"cmd":"ls -la"}',
          call_id: 'call_1',
        },
        {
          type: 'function_call_output',
          call_id: 'call_1',
          output: 'total 10',
        },
      ],
    })

    expect(normalized.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Explain this project' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Let me inspect the repo.' }] },
      { role: 'assistant', content: [{ type: 'tool_call', id: 'call_1', callId: 'call_1', name: 'exec_command', argumentsJson: '{"cmd":"ls -la"}' }] },
      { role: 'tool', content: [{ type: 'tool_result', toolCallId: 'call_1', result: 'total 10' }] },
    ])
  })
})

describe('parseOpenAIResponsesRequest parallel tool call coalescing', () => {
  it('coalesces consecutive function_call items into one assistant message', () => {
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

    // The two function_call items should be ONE assistant message
    const assistantToolMessages = normalized.messages.filter(
      (m) => m.role === 'assistant' && m.content.some((b) => b.type === 'tool_call'),
    )
    expect(assistantToolMessages).toHaveLength(1)
    expect(assistantToolMessages[0].content).toHaveLength(2)
    expect(assistantToolMessages[0].content[0]).toMatchObject({ type: 'tool_call', id: 'call_A' })
    expect(assistantToolMessages[0].content[1]).toMatchObject({ type: 'tool_call', id: 'call_B' })

    // Tool results stay as separate messages (correct for OpenAI Chat egress)
    const toolMessages = normalized.messages.filter((m) => m.role === 'tool')
    expect(toolMessages).toHaveLength(2)
  })

  it('preserves function_call items that are separated by other messages', () => {
    const normalized = parseOpenAIResponsesRequest({
      model: 'glm-5.2',
      input: [
        { role: 'user', content: [{ type: 'input_text', text: 'step 1' }] },
        { type: 'function_call', name: 'exec', arguments: '{}', call_id: 'call_1' },
        { type: 'function_call_output', call_id: 'call_1', output: 'done' },
        { role: 'user', content: [{ type: 'input_text', text: 'step 2' }] },
        { type: 'function_call', name: 'exec', arguments: '{}', call_id: 'call_2' },
        { type: 'function_call_output', call_id: 'call_2', output: 'done' },
      ],
    })

    const assistantToolMessages = normalized.messages.filter(
      (m) => m.role === 'assistant' && m.content.some((b) => b.type === 'tool_call'),
    )
    // call_1 and call_2 are separated by a user message, so they stay separate
    expect(assistantToolMessages).toHaveLength(2)
    expect(assistantToolMessages[0].content).toHaveLength(1)
    expect(assistantToolMessages[1].content).toHaveLength(1)
  })
})
