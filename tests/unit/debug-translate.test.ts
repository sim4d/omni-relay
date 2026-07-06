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
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          protocol: 'chat',
          payload: {
            model: 'gpt-5-mini',
            messages: [{ role: 'user', content: 'Hello' }],
          },
        }),
      }),
      { ENVIRONMENT: 'test' },
      ctx,
    )

    expect(response.status).toBe(200)
    const payload = await response.json() as Record<string, unknown>
    expect(payload.ok).toBe(true)
    expect(payload.provider).toBe('openai')
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
      { ENVIRONMENT: 'test', RELAY_API_KEY: 'relay-secret' },
      ctx,
    )

    expect(response.status).toBe(401)
  })
})
