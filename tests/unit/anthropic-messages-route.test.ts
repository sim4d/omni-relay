import worker from '../../src/index'

describe('POST /v1/messages', () => {
  const env = {
    ANTHROPIC_BASE_1: 'https://anthropic.example/v1',
    ANTHROPIC_AUTH_1: 'anthropic-secret',
    ANTHROPIC_MODEL_1: 'claude-*',
    RELAY_API_KEY: 'relay-secret',
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

  it('returns 401 when RELAY_API_KEY is set but the request carries no credential', async () => {
    vi.stubGlobal('fetch', vi.fn())

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

    expect(response.status).toBe(401)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns 401 when RELAY_API_KEY is unset on this route', async () => {
    vi.stubGlobal('fetch', vi.fn())

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
      { ANTHROPIC_BASE_1: 'https://anthropic.example/v1', ANTHROPIC_AUTH_1: 'anthropic-secret', ANTHROPIC_MODEL_1: 'claude-*' },
      ctx,
    )

    expect(response.status).toBe(401)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns 401 when the credential does not match RELAY_API_KEY on this route', async () => {
    vi.stubGlobal('fetch', vi.fn())

    const response = await worker.fetch(
      new Request('https://example.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'wrong-key',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-0',
          max_tokens: 256,
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      }),
      env,
      ctx,
    )

    expect(response.status).toBe(401)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('auto-appends /v1 to the upstream URL when ANTHROPIC_BASE has no /v1', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'msg_auto_v1',
          type: 'message',
          model: 'MiniMax-M1',
          content: [{ type: 'text', text: 'ok' }],
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
          model: 'MiniMax-M1',
          max_tokens: 256,
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      }),
      {
        ANTHROPIC_BASE_1: 'https://api.minimaxi.com/anthropic',
        ANTHROPIC_AUTH_1: 'minimax-secret',
        ANTHROPIC_MODEL_1: 'MiniMax*',
        RELAY_API_KEY: 'relay-secret',
      },
      ctx,
    )

    expect(response.status).toBe(200)
    const [url] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit]
    expect(url).toBe('https://api.minimaxi.com/anthropic/v1/messages')
  })
})
