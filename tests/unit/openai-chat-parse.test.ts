import { parseOpenAIChatRequest } from '../../src/protocols/openai-chat/parse'

describe('parseOpenAIChatRequest', () => {
  it('normalizes system instructions, user text, tools, and tool choice', () => {
    const normalized = parseOpenAIChatRequest({
      model: 'gpt-5-mini',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'lookup_weather',
            description: 'Get weather',
            parameters: { type: 'object', properties: { city: { type: 'string' } } },
          },
        },
      ],
      tool_choice: 'auto',
      temperature: 0.2,
      max_completion_tokens: 128,
    })

    expect(normalized.targetModel).toBe('gpt-5-mini')
    expect(normalized.instructions).toEqual([{ type: 'text', text: 'You are helpful.' }])
    expect(normalized.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Hello' }], name: undefined }])
    expect(normalized.tools?.[0]?.name).toBe('lookup_weather')
    expect(normalized.toolChoice).toEqual({ type: 'auto' })
    expect(normalized.output?.maxOutputTokens).toBe(128)
  })

  it('normalizes assistant tool calls and tool result messages', () => {
    const normalized = parseOpenAIChatRequest({
      model: 'gpt-5-mini',
      messages: [
        {
          role: 'assistant',
          content: 'Let me call a tool.',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'lookup_weather', arguments: '{"city":"Paris"}' },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'call_1',
          content: '{"temp":72}',
        },
      ],
    })

    expect(normalized.messages[0]?.content).toEqual([
      { type: 'text', text: 'Let me call a tool.' },
      { type: 'tool_call', id: 'call_1', name: 'lookup_weather', argumentsJson: '{"city":"Paris"}' },
    ])
    expect(normalized.messages[1]?.content).toEqual([
      { type: 'tool_result', toolCallId: 'call_1', result: '{"temp":72}' },
    ])
  })
})
