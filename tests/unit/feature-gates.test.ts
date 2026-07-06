import worker from '../../src/index'

describe('feature gating', () => {
  const ctx = {
    waitUntil() {},
    passThroughOnException() {},
  } as unknown as ExecutionContext

  it('rejects OpenAI Responses structured output config on cross-provider routes', async () => {
    vi.stubGlobal('fetch', vi.fn())

    const response = await worker.fetch(
      new Request('https://example.com/v1/responses', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-0',
          input: [{ role: 'user', content: [{ type: 'input_text', text: 'Hello' }] }],
          text: {
            format: {
              type: 'json_schema',
              name: 'weather',
              schema: { type: 'object' },
            },
          },
        }),
      }),
      { ENVIRONMENT: 'test', ANTHROPIC_API_KEY: 'anthropic-secret' },
      ctx,
    )

    expect(response.status).toBe(422)
  })

  it('allows OpenAI Responses structured output config on the same-provider route', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'resp_1',
          object: 'response',
          model: 'gpt-5.4-nano',
          status: 'completed',
          output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"ok":true}' }] }],
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
          model: 'gpt-5.4-nano',
          input: [{ role: 'user', content: [{ type: 'input_text', text: 'Hello' }] }],
          text: {
            format: {
              type: 'json_schema',
              name: 'weather',
              schema: { type: 'object' },
            },
          },
        }),
      }),
      { ENVIRONMENT: 'test', OPENAI_API_KEY: 'openai-secret' },
      ctx,
    )

    expect(response.status).toBe(200)
    const [, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.text).toBeTruthy()
  })
})
