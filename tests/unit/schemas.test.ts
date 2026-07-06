import { anthropicMessagesRequestSchema } from '../../src/protocols/anthropic-messages/schema'
import { openAIChatRequestSchema } from '../../src/protocols/openai-chat/schema'
import { openAIResponsesRequestSchema } from '../../src/protocols/openai-responses/schema'

describe('protocol request schemas', () => {
  it('accepts a minimal OpenAI chat request', () => {
    const parsed = openAIChatRequestSchema.parse({
      model: 'gpt-5-mini',
      messages: [{ role: 'user', content: 'Hello' }],
    })

    expect(parsed.model).toBe('gpt-5-mini')
  })

  it('accepts a minimal OpenAI responses request', () => {
    const parsed = openAIResponsesRequestSchema.parse({
      model: 'gpt-5-mini',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'Hello' }] }],
    })

    expect(parsed.model).toBe('gpt-5-mini')
  })

  it('accepts a minimal Anthropic messages request', () => {
    const parsed = anthropicMessagesRequestSchema.parse({
      model: 'claude-sonnet-4-0',
      max_tokens: 256,
      messages: [{ role: 'user', content: 'Hello' }],
    })

    expect(parsed.max_tokens).toBe(256)
  })
})
