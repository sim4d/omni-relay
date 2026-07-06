import { selectProvider } from '../../src/core/routing'

describe('provider routing', () => {
  it('routes OpenAI-native model prefixes to openai', () => {
    expect(selectProvider({ targetModel: 'gpt-5-mini', providerHint: 'auto' })).toBe('openai')
    expect(selectProvider({ targetModel: 'glm-5-turbo', providerHint: 'auto' })).toBe('openai')
    expect(selectProvider({ targetModel: 'kimi-k2.7-code', providerHint: 'auto' })).toBe('openai')
    expect(selectProvider({ targetModel: 'MiniMax-M3', providerHint: 'auto' })).toBe('openai')
  })

  it('routes claude models to anthropic', () => {
    expect(selectProvider({ targetModel: 'claude-sonnet-4-0', providerHint: 'auto' })).toBe('anthropic')
  })
})
