import { describe, expect, it, beforeEach } from 'vitest'
import {
  selectUpstreamTarget,
  selectUpstreamTargetWithFallback,
  _resetLastRoutedModel,
} from '../../src/core/routing'
import { ProviderSelectionError } from '../../src/errors'
import type { NormalizedRequest, UpstreamTargetsConfig } from '../../src/core/ir'

const GLM_TARGET = {
  slot: 4,
  kind: 'openai' as const,
  baseUrl: 'https://zai.example/v1',
  apiKey: 'k4',
  wireApi: 'chat_completions' as const,
  modelGlobs: ['glm-*'],
}

const KIMI_TARGET = {
  slot: 1,
  kind: 'openai' as const,
  baseUrl: 'https://kimi.example/v1',
  apiKey: 'k1',
  wireApi: 'chat_completions' as const,
  modelGlobs: ['kimi*'],
}

const CONFIG: UpstreamTargetsConfig = {
  openai: [GLM_TARGET, KIMI_TARGET],
  anthropic: [],
}

function makeRequest(model: string): NormalizedRequest {
  return {
    targetModel: model,
    messages: [],
    instructions: [],
    stream: false,
    extensions: {},
  }
}

describe('selectUpstreamTargetWithFallback', () => {
  beforeEach(() => {
    _resetLastRoutedModel()
  })

  it('routes normally when the model matches a target', () => {
    const req = makeRequest('glm-5.2')
    const { target, fallbackFrom } = selectUpstreamTargetWithFallback(req, CONFIG)
    expect(target).toEqual(GLM_TARGET)
    expect(fallbackFrom).toBeUndefined()
    expect(req.targetModel).toBe('glm-5.2')
  })

  it('records the model for future fallback', () => {
    const req = makeRequest('glm-5.2')
    selectUpstreamTargetWithFallback(req, CONFIG)

    // Now an unknown model should fall back to glm-5.2
    const req2 = makeRequest('gpt-5.4-mini')
    const { target, fallbackFrom } = selectUpstreamTargetWithFallback(req2, CONFIG)
    expect(target).toEqual(GLM_TARGET)
    expect(fallbackFrom).toBe('gpt-5.4-mini')
    expect(req2.targetModel).toBe('glm-5.2')
  })

  it('falls back to the last used model for unknown models (Codex gpt-5.4-mini scenario)', () => {
    // Simulate a prior successful request with glm-5.2
    selectUpstreamTargetWithFallback(makeRequest('glm-5.2'), CONFIG)

    // Codex CLI sends gpt-5.4-mini internally
    const req = makeRequest('gpt-5.4-mini')
    const { target, fallbackFrom } = selectUpstreamTargetWithFallback(req, CONFIG)

    expect(target).toEqual(GLM_TARGET)
    expect(fallbackFrom).toBe('gpt-5.4-mini')
    // The request model is mutated so the upstream sees the fallback model
    expect(req.targetModel).toBe('glm-5.2')
  })

  it('throws when no fallback model is available (cold start)', () => {
    const req = makeRequest('gpt-5.4-mini')
    expect(() => selectUpstreamTargetWithFallback(req, CONFIG)).toThrow(ProviderSelectionError)
    expect(() => selectUpstreamTargetWithFallback(req, CONFIG)).toThrow(/No upstream target matches/)
  })

  it('does not fall back when the requested model IS the last-used model', () => {
    // If the last-used model is itself unknown, don't loop
    selectUpstreamTargetWithFallback(makeRequest('glm-5.2'), CONFIG)
    const req = makeRequest('glm-5.2')
    const { fallbackFrom } = selectUpstreamTargetWithFallback(req, CONFIG)
    expect(fallbackFrom).toBeUndefined()
  })

  it('does not fall back when the requested model differs only in case from the last-used model', () => {
    // The same-model guard is case-insensitive (compare on toLowerCase()), so
    // a request for 'GLM-5.2' after a successful 'glm-5.2' must route normally
    // (no fallback) instead of being treated as an unknown model.
    selectUpstreamTargetWithFallback(makeRequest('glm-5.2'), CONFIG)
    const req = makeRequest('GLM-5.2')
    const { target, fallbackFrom } = selectUpstreamTargetWithFallback(req, CONFIG)
    expect(target).toEqual(GLM_TARGET)
    expect(fallbackFrom).toBeUndefined()
    // Model is unchanged (no substitution).
    expect(req.targetModel).toBe('GLM-5.2')
  })

  it('updates last-used model after a successful fallback', () => {
    // First request: glm-5.2
    selectUpstreamTargetWithFallback(makeRequest('glm-5.2'), CONFIG)
    // Unknown model falls back to glm-5.2
    selectUpstreamTargetWithFallback(makeRequest('gpt-5.4-mini'), CONFIG)
    // Another unknown model should still fall back to glm-5.2 (not gpt-5.4-mini)
    const req = makeRequest('some-other-unknown')
    const { target, fallbackFrom } = selectUpstreamTargetWithFallback(req, CONFIG)
    expect(target).toEqual(GLM_TARGET)
    expect(fallbackFrom).toBe('some-other-unknown')
    expect(req.targetModel).toBe('glm-5.2')
  })

  it('restores original model if the fallback also fails', () => {
    // Set up a fallback model that itself won't match in an empty config
    selectUpstreamTargetWithFallback(makeRequest('glm-5.2'), CONFIG)

    const emptyConfig: UpstreamTargetsConfig = { openai: [], anthropic: [] }
    const req = makeRequest('unknown-model')
    expect(() => selectUpstreamTargetWithFallback(req, emptyConfig)).toThrow(ProviderSelectionError)
    // Model should be restored to original
    expect(req.targetModel).toBe('unknown-model')
  })

  it('does not fall back on ambiguity errors (different model than last-used)', () => {
    // Prior successful route to glm-5.2 (unambiguous, matches only glm-*)
    selectUpstreamTargetWithFallback(makeRequest('glm-5.2'), CONFIG)

    // A *different* model that matches multiple globs must NOT be silently
    // swallowed by the fallback — the user should see the ambiguity error.
    const ambiguousConfig: UpstreamTargetsConfig = {
      openai: [
        { ...KIMI_TARGET, slot: 1, modelGlobs: ['kimi*'] },
        { ...KIMI_TARGET, slot: 2, modelGlobs: ['kimi-k*'] },
      ],
      anthropic: [],
    }
    const req = makeRequest('kimi-k2')
    expect(() => selectUpstreamTargetWithFallback(req, ambiguousConfig)).toThrow(
      /matches multiple/,
    )
    // Model must NOT have been mutated to the fallback model
    expect(req.targetModel).toBe('kimi-k2')
  })

  it('does not interfere with ambiguity errors (same model as last-used)', () => {
    // Edge: the last-used model is itself ambiguous in a new config.
    selectUpstreamTargetWithFallback(makeRequest('glm-5.2'), CONFIG)

    const ambiguousConfig: UpstreamTargetsConfig = {
      openai: [
        { ...GLM_TARGET, slot: 1, modelGlobs: ['glm-*'] },
        { ...GLM_TARGET, slot: 2, modelGlobs: ['glm-5*'] },
      ],
      anthropic: [],
    }
    expect(() => selectUpstreamTargetWithFallback(makeRequest('glm-5.2'), ambiguousConfig)).toThrow(
      /matches multiple/,
    )
  })
})
