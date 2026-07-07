import worker from '../../src/index'

describe('worker routing scaffold', () => {
  const env = {
    RELAY_API_KEY: 'relay-secret',
  }

  const ctx = {
    waitUntil() {},
    passThroughOnException() {},
  } as unknown as ExecutionContext

  it('returns health status', async () => {
    const response = await worker.fetch(new Request('https://example.com/healthz'), env, ctx)
    expect(response.status).toBe(200)

    const payload = await response.json() as { ok: boolean; service: string }
    expect(payload.ok).toBe(true)
    expect(payload.service).toBe('omni-relay')
  })

  it('returns 400 for chat completions requests with invalid JSON bodies', async () => {
    const response = await worker.fetch(
      new Request('https://example.com/v1/chat/completions', {
        method: 'POST',
        headers: { authorization: 'Bearer relay-secret' },
      }),
      env,
      ctx,
    )
    expect(response.status).toBe(400)
  })

  it('returns 404 for unknown routes', async () => {
    const response = await worker.fetch(new Request('https://example.com/unknown'), env, ctx)
    expect(response.status).toBe(404)
  })

  it('returns 401 on a production route when RELAY_API_KEY is unset', async () => {
    vi.stubGlobal('fetch', vi.fn())

    const response = await worker.fetch(
      new Request('https://example.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-5-mini',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      }),
      {},
      ctx,
    )

    expect(response.status).toBe(401)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns 401 on a production route when the credential does not match', async () => {
    vi.stubGlobal('fetch', vi.fn())

    const response = await worker.fetch(
      new Request('https://example.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer wrong-key',
        },
        body: JSON.stringify({
          model: 'gpt-5-mini',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      }),
      env,
      ctx,
    )

    expect(response.status).toBe(401)
    expect(fetch).not.toHaveBeenCalled()
  })
})
