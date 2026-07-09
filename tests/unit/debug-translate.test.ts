import worker from '../../src/index'

describe('POST /v1/debug/translate', () => {
  const ctx = {
    waitUntil() {},
    passThroughOnException() {},
  } as unknown as ExecutionContext

  it('returns normalized translation data for chat payloads', async () => {
    const response = await worker.fetch(
      new Request('https://example.com/v1/debug/translate', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer relay-secret',
        },
        body: JSON.stringify({
          protocol: 'chat',
          payload: {
            model: 'gpt-5-mini',
            messages: [{ role: 'user', content: 'Hello' }],
          },
        }),
      }),
      {
        ENABLE_DEBUG_ROUTES: 'true',
        RELAY_API_KEY: 'relay-secret',
        OPENAI_BASE_1: 'https://openai.example/v1',
        OPENAI_KEY_1: 'openai-secret',
        OPENAI_MODEL_1: 'gpt-*',
        ANTHROPIC_BASE_1: 'https://anthropic.example/v1',
        ANTHROPIC_AUTH_1: 'anthropic-secret',
        ANTHROPIC_MODEL_1: 'claude-*',
      },
      ctx,
    )

    expect(response.status).toBe(200)
    const payload = await response.json() as Record<string, unknown>
    expect(payload.ok).toBe(true)
    expect(payload.provider).toBe('openai')
  })

  it('accepts x-api-key relay auth for Anthropic-style debug clients', async () => {
    const response = await worker.fetch(
      new Request('https://example.com/v1/debug/translate', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'relay-secret',
        },
        body: JSON.stringify({
          protocol: 'messages',
          payload: {
            model: 'claude-sonnet-4-0',
            max_tokens: 64,
            messages: [{ role: 'user', content: 'Hello' }],
          },
        }),
      }),
      {
        ENABLE_DEBUG_ROUTES: 'true',
        RELAY_API_KEY: 'relay-secret',
        OPENAI_BASE_1: 'https://openai.example/v1',
        OPENAI_KEY_1: 'openai-secret',
        OPENAI_MODEL_1: 'gpt-*',
        ANTHROPIC_BASE_1: 'https://anthropic.example/v1',
        ANTHROPIC_AUTH_1: 'anthropic-secret',
        ANTHROPIC_MODEL_1: 'claude-*',
      },
      ctx,
    )

    expect(response.status).toBe(200)
    const payload = await response.json() as Record<string, unknown>
    expect(payload.ok).toBe(true)
    expect(payload.provider).toBe('anthropic')
  })

  it('enforces relay auth when configured', async () => {
    const response = await worker.fetch(
      new Request('https://example.com/v1/debug/translate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          protocol: 'chat',
          payload: {
            model: 'gpt-5-mini',
            messages: [{ role: 'user', content: 'Hello' }],
          },
        }),
      }),
      { ENABLE_DEBUG_ROUTES: 'true', RELAY_API_KEY: 'relay-secret' },
      ctx,
    )

    expect(response.status).toBe(401)
  })

  it('is disabled by default', async () => {
    const response = await worker.fetch(
      new Request('https://example.com/v1/debug/translate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          protocol: 'chat',
          payload: {
            model: 'gpt-5-mini',
            messages: [{ role: 'user', content: 'Hello' }],
          },
        }),
      }),
      { RELAY_API_KEY: 'relay-secret' },
      ctx,
    )

    expect(response.status).toBe(404)
  })
})
