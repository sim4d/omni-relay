import worker from '../../src/index'

describe('POST /v1/messages', () => {
  const env = {
    ENVIRONMENT: 'test',
    ANTHROPIC_API_KEY: 'anthropic-secret',
    ANTHROPIC_BASE_URL: 'https://anthropic.example/v1',
  }

  const ctx = {
    waitUntil() {},
    passThroughOnException() {},
  } as unknown as ExecutionContext

  it('calls Anthropic upstream and returns an Anthropic-compatible message response', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'msg_upstream_1',
          type: 'message',
          model: 'claude-sonnet-4-0',
          content: [{ type: 'text', text: 'omni relay ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 4 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    vi.stubGlobal('fetch', fetchMock)

    const response = await worker.fetch(
      new Request('https://example.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-0',
          max_tokens: 256,
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      }),
      env,
      ctx,
    )

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(response.headers.get('x-omni-upstream-latency-ms')).toBeTruthy()

    const [url] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit]
    expect(url).toBe('https://anthropic.example/v1/messages')

    const payload = await response.json() as Record<string, unknown>
    expect(payload.type).toBe('message')
    expect((payload.content as Array<Record<string, unknown>>)[0]?.text).toBe('omni relay ok')
  })

  it('accepts x-api-key relay auth for Anthropic-compatible clients', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'msg_upstream_2',
          type: 'message',
          model: 'claude-sonnet-4-0',
          content: [{ type: 'text', text: 'omni relay ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 4 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    vi.stubGlobal('fetch', fetchMock)

    const response = await worker.fetch(
      new Request('https://example.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'relay-secret',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-0',
          max_tokens: 256,
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      }),
      {
        ...env,
        RELAY_API_KEY: 'relay-secret',
      },
      ctx,
    )

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
