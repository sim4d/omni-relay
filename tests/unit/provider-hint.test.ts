import worker from '../../src/index'

describe('providerHint override', () => {
  const ctx = {
    waitUntil() {},
    passThroughOnException() {},
  } as unknown as ExecutionContext

  it('forces Anthropic routing on the messages route for glm models', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'msg_1',
          type: 'message',
          model: 'glm-4.7',
          content: [{ type: 'text', text: 'omni relay ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 4, output_tokens: 2 },
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
          providerHint: 'anthropic',
          model: 'glm-4.7',
          max_tokens: 64,
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      }),
      { ANTHROPIC_AUTH_TOKEN: 'token', ANTHROPIC_BASE_URL: 'https://anthropic.example/v1' },
      ctx,
    )

    expect(response.status).toBe(200)
    const [url] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit]
    expect(url).toBe('https://anthropic.example/v1/messages')
  })
})
