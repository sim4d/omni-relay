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
})
