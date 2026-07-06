import worker from '../../src/index'

describe('streaming route handlers', () => {
  const ctx = {
    waitUntil() {},
    passThroughOnException() {},
  } as unknown as ExecutionContext

  it('streams /v1/responses for OpenAI-routed requests', async () => {
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'event: response.created\n' +
            'data: {"type":"response.created","response":{"id":"resp_1","model":"gpt-5.4-nano"}}\n\n' +
            'event: response.output_text.delta\n' +
            'data: {"type":"response.output_text.delta","delta":"hello"}\n\n' +
            'event: response.completed\n' +
            'data: {"type":"response.completed","response":{"id":"resp_1"}}\n\n',
          ),
        )
        controller.close()
      },
    })

    vi.stubGlobal('fetch', vi.fn(async () => new Response(upstream, { status: 200 })))

    const response = await worker.fetch(
      new Request('https://example.com/v1/responses', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-5.4-nano',
          stream: true,
          input: [{ role: 'user', content: [{ type: 'input_text', text: 'Hello' }] }],
        }),
      }),
      { ENVIRONMENT: 'test', OPENAI_API_KEY: 'openai-secret', OPENAI_BASE_URL: 'https://openai.example/v1' },
      ctx,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
  })

  it('streams /v1/messages for Anthropic-routed requests', async () => {
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'event: message_start\n' +
            'data: {"type":"message_start","message":{"id":"msg_1","model":"claude-sonnet-4-0"}}\n\n' +
            'event: content_block_delta\n' +
            'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}\n\n' +
            'event: message_stop\n' +
            'data: {"type":"message_stop"}\n\n',
          ),
        )
        controller.close()
      },
    })

    vi.stubGlobal('fetch', vi.fn(async () => new Response(upstream, { status: 200 })))

    const response = await worker.fetch(
      new Request('https://example.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-0',
          max_tokens: 64,
          stream: true,
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      }),
      { ENVIRONMENT: 'test', ANTHROPIC_API_KEY: 'anthropic-secret', ANTHROPIC_BASE_URL: 'https://anthropic.example/v1' },
      ctx,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
  })

  it('streams /v1/chat/completions through an Anthropic upstream in cross-provider mode', async () => {
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'event: message_start\n' +
            'data: {"type":"message_start","message":{"id":"msg_1","model":"claude-sonnet-4-0"}}\n\n' +
            'event: content_block_delta\n' +
            'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}\n\n' +
            'event: message_stop\n' +
            'data: {"type":"message_stop"}\n\n',
          ),
        )
        controller.close()
      },
    })

    vi.stubGlobal('fetch', vi.fn(async () => new Response(upstream, { status: 200 })))

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
      { ENVIRONMENT: 'test', ANTHROPIC_API_KEY: 'anthropic-secret', ANTHROPIC_BASE_URL: 'https://anthropic.example/v1' },
      ctx,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
  })
})
