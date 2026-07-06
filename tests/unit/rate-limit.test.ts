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
})
