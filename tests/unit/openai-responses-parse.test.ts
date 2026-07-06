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

  it('preserves OpenAI Responses custom tools, custom tool choice, and same-provider request fields', () => {
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
      ],
      tool_choice: { type: 'custom', name: 'codex' },
      parallel_tool_calls: false,
      reasoning: { effort: 'high' },
    })

    expect(normalized.tools).toBeUndefined()
    expect(normalized.toolChoice).toEqual({ type: 'tool', name: 'codex', toolType: 'custom' })
    expect(normalized.extensions?.openai?.customTools).toEqual([
      {
        type: 'custom',
        name: 'codex',
        description: 'Run a Codex-native tool',
        format: { type: 'grammar', syntax: 'lark', definition: 'start: /.+/' },
      },
    ])
    expect(normalized.extensions?.openai?.unmappedRequestFields).toEqual({
      parallel_tool_calls: false,
      reasoning: { effort: 'high' },
    })
  })
})
