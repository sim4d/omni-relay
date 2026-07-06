import worker from '../../src/index'

describe('rate limiting', () => {
  const ctx = {
    waitUntil() {},
    passThroughOnException() {},
  } as unknown as ExecutionContext

  it('returns 429 when the rate limiter binding rejects the request', async () => {
    const response = await worker.fetch(
      new Request('https://example.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-5-mini',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      }),
      {
        ENVIRONMENT: 'test',
        OPENAI_API_KEY: 'openai-secret',
        RATE_LIMITER: {
          async limit() {
            return { success: false }
          },
        },
      },
      ctx,
    )

    expect(response.status).toBe(429)
  })

  it('returns 429 when the durable-object limiter rejects the request', async () => {
    const getByName = vi.fn(() => ({
      async checkLimit() {
        return {
          success: false,
          remaining: 0,
          resetAtMs: Date.now() + 10_000,
          retryAfterSeconds: 10,
        }
      },
    }))

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
        ENVIRONMENT: 'test',
        ENABLE_DEBUG_ROUTES: 'true',
        RELAY_API_KEY: 'relay-secret',
        RATE_LIMIT_MAX: '2',
        RATE_LIMIT_PERIOD_SECONDS: '10',
        RELAY_RATE_LIMITER_DO: { getByName },
      },
      ctx,
    )

    expect(response.status).toBe(429)
    expect(getByName).toHaveBeenCalledTimes(1)
  })

  it('uses x-api-key-authenticated clients as the rate-limit key', async () => {
    const limit = vi.fn(async ({ key }: { key: string }) => {
      expect(key).toBe('/v1/messages|credential:relay-secret')
      return { success: false }
    })

    const response = await worker.fetch(
      new Request('https://example.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'relay-secret',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-0',
          max_tokens: 64,
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      }),
      {
        ENVIRONMENT: 'test',
        RELAY_API_KEY: 'relay-secret',
        ANTHROPIC_API_KEY: 'anthropic-secret',
        RATE_LIMITER: { limit },
      },
      ctx,
    )

    expect(response.status).toBe(429)
    expect(limit).toHaveBeenCalledTimes(1)
  })
})
