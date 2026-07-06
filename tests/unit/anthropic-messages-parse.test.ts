import { parseAnthropicMessagesRequest } from '../../src/protocols/anthropic-messages/parse'

describe('parseAnthropicMessagesRequest', () => {
  it('normalizes system prompts, text blocks, tools, and tool choice', () => {
    const normalized = parseAnthropicMessagesRequest({
      model: 'claude-sonnet-4-0',
      max_tokens: 256,
      system: 'Be concise.',
      messages: [
        { role: 'user', content: 'Hello' },
      ],
      tools: [
        { name: 'lookup_weather', description: 'Get weather', input_schema: { type: 'object' } },
      ],
      tool_choice: { type: 'auto' },
    })

    expect(normalized.instructions).toEqual([{ type: 'text', text: 'Be concise.' }])
    expect(normalized.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }])
    expect(normalized.output?.maxOutputTokens).toBe(256)
    expect(normalized.toolChoice).toEqual({ type: 'auto' })
  })

  it('normalizes tool_use and tool_result blocks', () => {
    const normalized = parseAnthropicMessagesRequest({
      model: 'claude-sonnet-4-0',
      max_tokens: 256,
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'toolu_1', name: 'lookup_weather', input: { city: 'Paris' } },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_1', content: '72F' },
          ],
        },
      ],
    })

    expect(normalized.messages[0]?.content).toEqual([
      { type: 'tool_call', id: 'toolu_1', name: 'lookup_weather', argumentsJson: '{"city":"Paris"}' },
    ])
    expect(normalized.messages[1]).toEqual({
      role: 'tool',
      content: [
        { type: 'tool_result', toolCallId: 'toolu_1', result: '72F', isError: undefined },
      ],
    })
  })

  it('splits mixed user content and tool_result blocks into user/tool messages', () => {
    const normalized = parseAnthropicMessagesRequest({
      model: 'glm-5.2',
      max_tokens: 256,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Here are the tool results.' },
            { type: 'tool_result', tool_use_id: 'toolu_1', content: '72F' },
            { type: 'tool_result', tool_use_id: 'toolu_2', content: '18C' },
          ],
        },
      ],
    })

    expect(normalized.messages).toEqual([
      {
        role: 'user',
        content: [{ type: 'text', text: 'Here are the tool results.' }],
      },
      {
        role: 'tool',
        content: [{ type: 'tool_result', toolCallId: 'toolu_1', result: '72F', isError: undefined }],
      },
      {
        role: 'tool',
        content: [{ type: 'tool_result', toolCallId: 'toolu_2', result: '18C', isError: undefined }],
      },
    ])
  })

  it('converts pure user tool_result batches into tool messages', () => {
    const normalized = parseAnthropicMessagesRequest({
      model: 'glm-5.2',
      max_tokens: 256,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_1', content: '72F' },
          ],
        },
      ],
    })

    expect(normalized.messages[0]).toEqual({
      role: 'tool',
      content: [
        { type: 'tool_result', toolCallId: 'toolu_1', result: '72F', isError: undefined },
      ],
    })
  })

  it('folds system-role messages into instructions', () => {
    const normalized = parseAnthropicMessagesRequest({
      model: 'glm-5.2',
      max_tokens: 256,
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'system', content: 'Use terse bullets.' },
      ],
    })

    expect(normalized.instructions).toEqual([{ type: 'text', text: 'Use terse bullets.' }])
    expect(normalized.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }])
  })
})
