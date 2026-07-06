import worker from '../../src/index'

describe('worker routing scaffold', () => {
  const env = {
    ENVIRONMENT: 'test',
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
    const response = await worker.fetch(new Request('https://example.com/v1/chat/completions', { method: 'POST' }), env, ctx)
    expect(response.status).toBe(400)
  })

  it('returns 404 for unknown routes', async () => {
    const response = await worker.fetch(new Request('https://example.com/unknown'), env, ctx)
    expect(response.status).toBe(404)
  })
})
