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

  it('uses x-api-key-authenticated clients as the rate-limit key', async () => {
    const limit = vi.fn(async ({ key }: { key: string }) => {
      expect(key).toBe('credential:relay-secret')
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
