import { describe, expect, it } from 'vitest'
import { hasUpstreamConfig, parseUpstreamTargets, resolveUpstreamTargets } from '../../src/config'
import { ConfigurationError } from '../../src/errors'
import type { AppEnv } from '../../src/env'

function singleOpenai(env: Partial<AppEnv> = {}): AppEnv {
  return {
    OPENAI_BASE_1: 'https://openai.example/v1',
    OPENAI_KEY_1: 'upstream-secret',
    OPENAI_MODEL_1: 'gpt-*,glm-4*',
    ...env,
  }
}

describe('parseUpstreamTargets', () => {
  it('groups a single OpenAI target', () => {
    const config = parseUpstreamTargets(singleOpenai())
    expect(config.openai).toHaveLength(1)
    expect(config.anthropic).toHaveLength(0)
    const target = config.openai[0]!
    expect(target.slot).toBe(1)
    expect(target.kind).toBe('openai')
    expect(target.baseUrl).toBe('https://openai.example/v1')
    expect(target.apiKey).toBe('upstream-secret')
    expect(target.wireApi).toBe('chat_completions')
    expect(target.modelGlobs).toEqual(['gpt-*', 'glm-4*'])
  })

  it('defaults wireApi to chat_completions when OPENAI_WIRE_<N> is unset', () => {
    const config = parseUpstreamTargets(singleOpenai())
    expect(config.openai[0]!.wireApi).toBe('chat_completions')
  })

  it('opts into responses when OPENAI_WIRE_<N>=responses', () => {
    const config = parseUpstreamTargets(singleOpenai({ OPENAI_WIRE_1: 'responses' }))
    expect(config.openai[0]!.wireApi).toBe('responses')
  })

  it('falls back to chat_completions for an unknown wire value (typo)', () => {
    const config = parseUpstreamTargets(singleOpenai({ OPENAI_WIRE_1: 'chat_completion' }))
    expect(config.openai[0]!.wireApi).toBe('chat_completions')
  })

  it('supports multiple OpenAI slots with independent wire formats', () => {
    const env = singleOpenai({
      OPENAI_BASE_2: 'https://responses.example/v1',
      OPENAI_KEY_2: 'other-secret',
      OPENAI_WIRE_2: 'responses',
      OPENAI_MODEL_2: 'responses-only-*',
    })
    const config = parseUpstreamTargets(env)
    expect(config.openai).toHaveLength(2)
    expect(config.openai[0]!.wireApi).toBe('chat_completions')
    expect(config.openai[1]!.wireApi).toBe('responses')
    expect(config.openai[1]!.modelGlobs).toEqual(['responses-only-*'])
  })

  it('parses an Anthropic target as Bearer auth', () => {
    const env: AppEnv = {
      ANTHROPIC_BASE_1: 'https://anthropic.example',
      ANTHROPIC_AUTH_1: 'anthropic-secret',
      ANTHROPIC_MODEL_1: 'claude-*',
    }
    const config = parseUpstreamTargets(env)
    expect(config.anthropic).toHaveLength(1)
    const target = config.anthropic[0]!
    expect(target.kind).toBe('anthropic')
    expect(target.authToken).toBe('anthropic-secret')
    expect(target.apiKey).toBeUndefined()
    expect(target.baseUrl).toBe('https://anthropic.example')
  })

  it('strips trailing /v1 from Anthropic base URLs (backward compat)', () => {
    const env: AppEnv = {
      ANTHROPIC_BASE_1: 'https://api.minimaxi.com/anthropic/v1',
      ANTHROPIC_AUTH_1: 'secret',
      ANTHROPIC_MODEL_1: 'MiniMax*',
    }
    const config = parseUpstreamTargets(env)
    expect(config.anthropic[0]!.baseUrl).toBe('https://api.minimaxi.com/anthropic')
  })

  it('does not strip /v1 from OpenAI base URLs', () => {
    const env: AppEnv = {
      OPENAI_BASE_1: 'https://openrouter.ai/api/v1',
      OPENAI_KEY_1: 'secret',
      OPENAI_MODEL_1: 'gpt-*',
    }
    const config = parseUpstreamTargets(env)
    expect(config.openai[0]!.baseUrl).toBe('https://openrouter.ai/api/v1')
  })

  it('strips trailing slashes then /v1 from Anthropic base URLs', () => {
    const env: AppEnv = {
      ANTHROPIC_BASE_1: 'https://open.bigmodel.cn/api/anthropic/v1///',
      ANTHROPIC_AUTH_1: 'secret',
      ANTHROPIC_MODEL_1: 'glm-*',
    }
    const config = parseUpstreamTargets(env)
    expect(config.anthropic[0]!.baseUrl).toBe('https://open.bigmodel.cn/api/anthropic')
  })

  it('leaves Anthropic base URL unchanged when it has no /v1 suffix', () => {
    const env: AppEnv = {
      ANTHROPIC_BASE_1: 'https://api.z.ai/api/anthropic',
      ANTHROPIC_AUTH_1: 'secret',
      ANTHROPIC_MODEL_1: 'glm-*',
    }
    const config = parseUpstreamTargets(env)
    expect(config.anthropic[0]!.baseUrl).toBe('https://api.z.ai/api/anthropic')
  })

  it('strips a root-level /v1 from Anthropic base URLs (host + /v1 only)', () => {
    const env: AppEnv = {
      ANTHROPIC_BASE_1: 'https://api.host/v1',
      ANTHROPIC_AUTH_1: 'secret',
      ANTHROPIC_MODEL_1: 'claude-*',
    }
    const config = parseUpstreamTargets(env)
    expect(config.anthropic[0]!.baseUrl).toBe('https://api.host')
  })

  it('strips an uppercase /V1 suffix from Anthropic base URLs (case-insensitive)', () => {
    const env: AppEnv = {
      ANTHROPIC_BASE_1: 'https://api.host/anthropic/V1',
      ANTHROPIC_AUTH_1: 'secret',
      ANTHROPIC_MODEL_1: 'claude-*',
    }
    const config = parseUpstreamTargets(env)
    expect(config.anthropic[0]!.baseUrl).toBe('https://api.host/anthropic')
  })

  it('rejects an Anthropic base URL that normalizes to empty after /v1 stripping', () => {
    const env: AppEnv = {
      ANTHROPIC_BASE_1: '/v1',
      ANTHROPIC_AUTH_1: 'secret',
      ANTHROPIC_MODEL_1: 'claude-*',
    }
    expect(() => parseUpstreamTargets(env)).toThrow(ConfigurationError)
    expect(() => parseUpstreamTargets(env)).toThrow(/must be a non-empty base URL/)
  })

  it('strips trailing slashes from base URLs', () => {
    const config = parseUpstreamTargets(singleOpenai({ OPENAI_BASE_1: 'https://openai.example/v1///' }))
    expect(config.openai[0]!.baseUrl).toBe('https://openai.example/v1')
  })

  it('rejects a declared slot missing a mandatory field', () => {
    const env: AppEnv = {
      OPENAI_BASE_1: 'https://openai.example/v1',
      OPENAI_MODEL_1: 'gpt-*',
    }
    expect(() => parseUpstreamTargets(env)).toThrow(ConfigurationError)
    expect(() => parseUpstreamTargets(env)).toThrow(/OPENAI_KEY_1/)
  })

  it('rejects an empty model glob list', () => {
    const env: AppEnv = {
      OPENAI_BASE_1: 'https://openai.example/v1',
      OPENAI_KEY_1: 'secret',
      OPENAI_MODEL_1: ' , ',
    }
    expect(() => parseUpstreamTargets(env)).toThrow(/at least one model glob/)
  })

  it('rejects a bare catch-all glob "*"', () => {
    const env = singleOpenai({ OPENAI_MODEL_1: '*' })
    expect(() => parseUpstreamTargets(env)).toThrow(ConfigurationError)
    expect(() => parseUpstreamTargets(env)).toThrow(/must not use a bare catch-all glob/)
  })

  it('rejects a bare catch-all even when listed alongside other globs', () => {
    const env = singleOpenai({ OPENAI_MODEL_1: 'glm-5.2,*' })
    expect(() => parseUpstreamTargets(env)).toThrow(/must not use a bare catch-all glob/)
  })

  it('allows broad-prefix globs that are not bare catch-alls', () => {
    const env = singleOpenai({ OPENAI_MODEL_1: 'gpt-*' })
    expect(parseUpstreamTargets(env).openai[0]!.modelGlobs).toEqual(['gpt-*'])
  })

  it('orders slots numerically regardless of env iteration order', () => {
    const env: AppEnv = {
      OPENAI_BASE_2: 'https://b.example/v1',
      OPENAI_KEY_2: 's2',
      OPENAI_MODEL_2: 'm2',
      OPENAI_BASE_1: 'https://a.example/v1',
      OPENAI_KEY_1: 's1',
      OPENAI_MODEL_1: 'm1',
    }
    const config = parseUpstreamTargets(env)
    expect(config.openai.map((t) => t.slot)).toEqual([1, 2])
  })

  it('rejects a "**" glob that reduces to an empty literal (catch-all bypass)', () => {
    const env = singleOpenai({ OPENAI_MODEL_1: '**' })
    expect(() => parseUpstreamTargets(env)).toThrow(ConfigurationError)
    expect(() => parseUpstreamTargets(env)).toThrow(/must not use a bare catch-all glob/)
  })

  it('rejects a "*?" style glob that reduces to an empty literal', () => {
    const env = singleOpenai({ OPENAI_MODEL_1: '*?' })
    expect(() => parseUpstreamTargets(env)).toThrow(/must not use a bare catch-all glob/)
  })

  it('rejects a base URL that normalizes to empty (only slashes)', () => {
    const env = singleOpenai({ OPENAI_BASE_1: '////' })
    expect(() => parseUpstreamTargets(env)).toThrow(ConfigurationError)
    expect(() => parseUpstreamTargets(env)).toThrow(/OPENAI_BASE_1 must be a non-empty base URL/)
  })
})

describe('hasUpstreamConfig', () => {
  it('is false when no target vars are set', () => {
    expect(hasUpstreamConfig({ RELAY_API_KEY: 'x' })).toBe(false)
  })

  it('is true when any target var is set, even if incomplete', () => {
    expect(hasUpstreamConfig({ OPENAI_BASE_1: 'https://x.example' })).toBe(true)
  })
})

describe('resolveUpstreamTargets', () => {
  it('returns the parsed config when at least one target exists', () => {
    const targets = resolveUpstreamTargets(singleOpenai())
    expect(targets.openai).toHaveLength(1)
  })

  it('throws a friendly ConfigurationError when nothing is configured', () => {
    expect(() => resolveUpstreamTargets({})).toThrow(ConfigurationError)
    expect(() => resolveUpstreamTargets({})).toThrow(/OPENAI_BASE_1/)
  })

  it('rejects incomplete config with the missing-field message', () => {
    // A partially-declared slot surfaces the specific missing fields, not the
    // generic "no complete target" summary.
    expect(() => resolveUpstreamTargets({ OPENAI_BASE_1: 'https://x.example' })).toThrow(/missing required field/)
    expect(() => resolveUpstreamTargets({ OPENAI_BASE_1: 'https://x.example' })).toThrow(/OPENAI_KEY_1/)
  })
})
