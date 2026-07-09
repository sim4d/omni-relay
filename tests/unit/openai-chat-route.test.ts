import worker from '../../src/index'

describe('POST /v1/chat/completions', () => {
  const env = {
    OPENAI_BASE_1: 'https://openai.example/v1',
    OPENAI_KEY_1: 'upstream-secret',
    OPENAI_MODEL_1: 'gpt-*',
    ANTHROPIC_BASE_1: 'https://anthropic.example/v1',
    ANTHROPIC_AUTH_1: 'anthropic-secret',
    ANTHROPIC_MODEL_1: 'claude-*',
    RELAY_API_KEY: 'relay-secret',
  }

  const ctx = {
    waitUntil() {},
    passThroughOnException() {},
  } as unknown as ExecutionContext

  it('calls OpenAI Responses upstream and renders a chat completion payload', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'resp_upstream_1',
          object: 'response',
          model: 'gpt-5-mini',
          status: 'completed',
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'Hello from upstream' }],
            },
          ],
          usage: { input_tokens: 5, output_tokens: 4, total_tokens: 9 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    vi.stubGlobal('fetch', fetchMock)

    const response = await worker.fetch(
      new Request('https://example.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer relay-secret',
        },
        body: JSON.stringify({
          model: 'gpt-5-mini',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      }),
      { ...env, OPENAI_WIRE_1: 'responses' },
      ctx,
    )

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(response.headers.get('x-omni-upstream-latency-ms')).toBeTruthy()

    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit]
    expect(url).toBe('https://openai.example/v1/responses')
    expect(init.method).toBe('POST')

    const payload = await response.json() as Record<string, unknown>
    expect(payload.object).toBe('chat.completion')
    expect((payload.choices as Array<Record<string, unknown>>)[0]?.finish_reason).toBe('stop')
  })

  it('defaults to the chat-completions upstream when OPENAI_WIRE_1 is unset', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'chatcmpl_default_1',
          object: 'chat.completion',
          model: 'gpt-5-mini',
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: { role: 'assistant', content: 'default ok' },
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const response = await worker.fetch(
      new Request('https://example.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer relay-secret',
        },
        body: JSON.stringify({
          model: 'gpt-5-mini',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      }),
      env,
      ctx,
    )

    expect(response.status).toBe(200)
    const [url] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit]
    expect(url).toBe('https://openai.example/v1/chat/completions')
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
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns an SSE stream for OpenAI-routed streaming requests', async () => {
    const streamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'event: response.created\\n' +
            'data: {\"type\":\"response.created\",\"response\":{\"id\":\"resp_1\",\"model\":\"gpt-5-mini\"}}\\n\\n' +
            'event: response.output_text.delta\\n' +
            'data: {\"type\":\"response.output_text.delta\",\"delta\":\"omni \"}\\n\\n' +
            'event: response.output_text.delta\\n' +
            'data: {\"type\":\"response.output_text.delta\",\"delta\":\"relay ok\"}\\n\\n' +
            'event: response.completed\\n' +
            'data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_1\"}}\\n\\n',
          ),
        )
        controller.close()
      },
    })

    vi.stubGlobal('fetch', vi.fn(async () => new Response(streamBody, { status: 200 })))

    const response = await worker.fetch(
      new Request('https://example.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer relay-secret',
        },
        body: JSON.stringify({
          model: 'gpt-5-mini',
          stream: true,
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      }),
      { ...env, OPENAI_WIRE_1: 'responses' },
      ctx,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(response.headers.get('x-omni-upstream-latency-ms')).toBeTruthy()

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
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer relay-secret',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-0',
          stream: true,
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      }),
      env,
      ctx,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
  })
})
