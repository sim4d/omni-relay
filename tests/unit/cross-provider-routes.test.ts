import worker from '../../src/index'

describe('cross-provider non-streaming routing', () => {
  const ctx = {
    waitUntil() {},
    passThroughOnException() {},
  } as unknown as ExecutionContext

  it('renders an OpenAI chat completion from an Anthropic upstream response', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'msg_upstream_cross_1',
          type: 'message',
          model: 'claude-sonnet-4-0',
          content: [{ type: 'text', text: 'cross provider ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 4, output_tokens: 3 },
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
          model: 'claude-sonnet-4-0',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      }),
      {
        ENVIRONMENT: 'test',
        ANTHROPIC_API_KEY: 'anthropic-secret',
        ANTHROPIC_BASE_URL: 'https://anthropic.example/v1',
      },
      ctx,
    )

    expect(response.status).toBe(200)
    const [url] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit]
    expect(url).toBe('https://anthropic.example/v1/messages')

    const payload = await response.json() as Record<string, unknown>
    expect(payload.object).toBe('chat.completion')
  })

  it('renders an Anthropic message response from an OpenAI Responses upstream response', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'resp_cross_1',
          object: 'response',
          model: 'gpt-5.4-nano',
          status: 'completed',
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'cross provider ok' }],
            },
          ],
          usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
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
          model: 'gpt-5.4-nano',
          max_tokens: 128,
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      }),
      {
        ENVIRONMENT: 'test',
        OPENAI_API_KEY: 'openai-secret',
        OPENAI_BASE_URL: 'https://openai.example/v1',
      },
      ctx,
    )

    expect(response.status).toBe(200)
    const [url] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit]
    expect(url).toBe('https://openai.example/v1/responses')

    const payload = await response.json() as Record<string, unknown>
    expect(payload.type).toBe('message')
  })

  it('renders an OpenAI Responses payload from an Anthropic upstream response', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'msg_cross_2',
          type: 'message',
          model: 'claude-sonnet-4-0',
          content: [{ type: 'text', text: 'cross provider ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 4, output_tokens: 2 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    vi.stubGlobal('fetch', fetchMock)

    const response = await worker.fetch(
      new Request('https://example.com/v1/responses', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-0',
          input: [{ role: 'user', content: [{ type: 'input_text', text: 'Hello' }] }],
        }),
      }),
      {
        ENVIRONMENT: 'test',
        ANTHROPIC_API_KEY: 'anthropic-secret',
        ANTHROPIC_BASE_URL: 'https://anthropic.example/v1',
      },
      ctx,
    )

    expect(response.status).toBe(200)
    const [url] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit]
    expect(url).toBe('https://anthropic.example/v1/messages')

    const payload = await response.json() as Record<string, unknown>
    expect(payload.object).toBe('response')
  })
})
