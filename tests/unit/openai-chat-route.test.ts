import worker from '../../src/index'

describe('POST /v1/chat/completions', () => {
  const env = {
    ENVIRONMENT: 'test',
    OPENAI_API_KEY: 'upstream-secret',
  }

  const ctx = {
    waitUntil() {},
    passThroughOnException() {},
  } as unknown as ExecutionContext

  it('calls OpenAI upstream and returns a chat completion payload', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'chatcmpl_upstream_1',
          object: 'chat.completion',
          model: 'gpt-5-mini',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Hello from upstream' },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 5,
            completion_tokens: 4,
            total_tokens: 9,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    vi.stubGlobal('fetch', fetchMock)

    const response = await worker.fetch(
      new Request('https://example.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-5-mini',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      }),
      env,
      ctx,
    )

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(init.method).toBe('POST')

    const payload = await response.json() as Record<string, unknown>
    expect(payload.object).toBe('chat.completion')
    expect((payload.choices as Array<Record<string, unknown>>)[0]?.finish_reason).toBe('stop')
  })

  it('returns 401 when relay auth is configured and missing', async () => {
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
      {
        ...env,
        RELAY_API_KEY: 'relay-secret',
      },
      ctx,
    )

    expect(response.status).toBe(401)
  })

  it('returns an SSE stream for OpenAI-routed streaming requests', async () => {
    const streamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {\"id\":\"chatcmpl_stream_1\",\"object\":\"chat.completion.chunk\",\"model\":\"gpt-5-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"omni \"},\"finish_reason\":null}]}\\n\\n' +
            'data: {\"id\":\"chatcmpl_stream_1\",\"object\":\"chat.completion.chunk\",\"model\":\"gpt-5-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"relay ok\"},\"finish_reason\":\"stop\"}]}\\n\\n' +
            'data: [DONE]\\n\\n',
          ),
        )
        controller.close()
      },
    })

    vi.stubGlobal('fetch', vi.fn(async () => new Response(streamBody, { status: 200 })))

    const response = await worker.fetch(
      new Request('https://example.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-5-mini',
          stream: true,
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      }),
      env,
      ctx,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')

    const [, init] = vi.mocked(fetch).mock.calls[0]! as unknown as [string, RequestInit]
    const upstreamPayload = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(upstreamPayload.stream).toBe(true)
  })

  it('returns an SSE stream for Anthropic-routed streaming requests in cross-provider mode', async () => {
    const streamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'event: message_start\\n' +
            'data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_1\",\"model\":\"claude-sonnet-4-0\"}}\\n\\n' +
            'event: content_block_delta\\n' +
            'data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"hello\"}}\\n\\n' +
            'event: message_stop\\n' +
            'data: {\"type\":\"message_stop\"}\\n\\n',
          ),
        )
        controller.close()
      },
    })

    vi.stubGlobal('fetch', vi.fn(async () => new Response(streamBody, { status: 200 })))

    const response = await worker.fetch(
      new Request('https://example.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-0',
          stream: true,
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      }),
      {
        ENVIRONMENT: 'test',
        ANTHROPIC_API_KEY: 'anthropic-secret',
      },
      ctx,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
  })
})
