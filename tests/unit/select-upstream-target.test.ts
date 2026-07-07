import { describe, expect, it } from 'vitest'
import { selectProvider, selectUpstreamTarget } from '../../src/core/routing'
import { ProviderSelectionError } from '../../src/errors'
import type { UpstreamTargetsConfig } from '../../src/core/ir'

const OPENAI_GPT = {
  slot: 1,
  kind: 'openai' as const,
  baseUrl: 'https://openai.example/v1',
  apiKey: 'k1',
  wireApi: 'chat_completions' as const,
  modelGlobs: ['gpt-*'],
}

const OPENAI_GLM_RESPONSES = {
  slot: 2,
  kind: 'openai' as const,
  baseUrl: 'https://glm.example/v1',
  apiKey: 'k2',
  wireApi: 'responses' as const,
  modelGlobs: ['glm-4*'],
}

const ANTHROPIC_CLAUDE = {
  slot: 1,
  kind: 'anthropic' as const,
  baseUrl: 'https://anthropic.example',
  authToken: 'a1',
  modelGlobs: ['claude-*'],
}

const TWO_OPENAI: UpstreamTargetsConfig = { openai: [OPENAI_GPT, OPENAI_GLM_RESPONSES], anthropic: [] }
const BOTH: UpstreamTargetsConfig = { openai: [OPENAI_GPT], anthropic: [ANTHROPIC_CLAUDE] }

describe('selectUpstreamTarget', () => {
  it('selects the only matching target by glob', () => {
    expect(selectUpstreamTarget({ targetModel: 'gpt-5-mini' }, TWO_OPENAI)).toEqual(OPENAI_GPT)
    expect(selectUpstreamTarget({ targetModel: 'glm-4.7' }, TWO_OPENAI)).toEqual(OPENAI_GLM_RESPONSES)
  })

  it('walks openai before anthropic when providerHint is auto', () => {
    expect(selectUpstreamTarget({ targetModel: 'gpt-5' }, BOTH).kind).toBe('openai')
    expect(selectUpstreamTarget({ targetModel: 'claude-opus-4' }, BOTH).kind).toBe('anthropic')
  })

  it('restricts to the providerHint kind when set', () => {
    expect(() => selectUpstreamTarget({ targetModel: 'gpt-5', providerHint: 'anthropic' }, BOTH)).toThrow(ProviderSelectionError)
  })

  it('throws when no target matches the model', () => {
    expect(() => selectUpstreamTarget({ targetModel: 'unknown-model' }, TWO_OPENAI)).toThrow(ProviderSelectionError)
    expect(() => selectUpstreamTarget({ targetModel: 'unknown-model' }, TWO_OPENAI)).toThrow(/No upstream target matches/)
  })

  it('lists the configured targets in the no-match error', () => {
    expect(() => selectUpstreamTarget({ targetModel: 'nope' }, BOTH)).toThrow(/OPENAI_1=gpt-\*/)
  })

  it('throws on overlapping glob matches', () => {
    const config: UpstreamTargetsConfig = {
      openai: [
        { ...OPENAI_GPT, slot: 1, modelGlobs: ['gpt-*'] },
        { ...OPENAI_GPT, slot: 2, modelGlobs: ['gpt-5*'] },
      ],
      anthropic: [],
    }
    expect(() => selectUpstreamTarget({ targetModel: 'gpt-5-mini' }, config)).toThrow(/matches multiple/)
  })

  it('matches case-insensitively', () => {
    expect(selectUpstreamTarget({ targetModel: 'GPT-5-MINI' }, TWO_OPENAI)).toEqual(OPENAI_GPT)
  })

  it('returns the resolved provider id via selectProvider', () => {
    expect(selectProvider({ targetModel: 'gpt-5-mini' }, TWO_OPENAI)).toBe('openai')
  })

  it('throws when globs overlap across kinds', () => {
    const config: UpstreamTargetsConfig = {
      openai: [{ ...OPENAI_GPT, modelGlobs: ['glm-*'] }],
      anthropic: [{ ...ANTHROPIC_CLAUDE, modelGlobs: ['glm-*'] }],
    }
    expect(() => selectUpstreamTarget({ targetModel: 'glm-4.7' }, config)).toThrow(/matches multiple/)
  })
})
