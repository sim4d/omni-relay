import { globToRegExp, matchesAnyGlob, matchesGlob } from '../../src/core/model-glob'

describe('model-glob matching', () => {
  it('treats * as a wildcard run of characters', () => {
    expect(matchesGlob('gpt-5-mini', 'gpt-*')).toBe(true)
    expect(matchesGlob('glm-4.7', 'glm-*')).toBe(true)
    expect(matchesGlob('claude-3-haiku', 'claude-*')).toBe(true)
    expect(matchesGlob('gpt-5-mini', 'glm-*')).toBe(false)
  })

  it('matches the full model name, not a substring', () => {
    expect(matchesGlob('gpt-5-mini', 'gpt-')).toBe(false)
    expect(matchesGlob('gpt-5-mini', '*')).toBe(true)
  })

  it('treats ? as a single character', () => {
    expect(matchesGlob('gpt-5', 'gpt-?')).toBe(true)
    expect(matchesGlob('gpt-55', 'gpt-?')).toBe(false)
  })

  it('escapes regex metacharacters so they match literally', () => {
    expect(matchesGlob('model.v2', 'model.v2')).toBe(true)
    expect(matchesGlob('modelXv2', 'model.v2')).toBe(false)
    expect(matchesGlob('(glm)', '(glm)')).toBe(true)
  })

  it('matches case-insensitively', () => {
    expect(matchesGlob('MiniMax-M3', 'minimax-*')).toBe(true)
    expect(matchesGlob('GPT-5', 'gpt-*')).toBe(true)
  })

  it('globToRegExp is stable and repeatable', () => {
    expect(globToRegExp('gpt-*').source).toBe(globToRegExp('gpt-*').source)
  })

  it('matchesAnyGlob returns true when any pattern matches', () => {
    expect(matchesAnyGlob('glm-4.7', ['gpt-*', 'glm-4*'])).toBe(true)
    expect(matchesAnyGlob('claude-opus-4', ['gpt-*', 'glm-4*'])).toBe(false)
  })
})
