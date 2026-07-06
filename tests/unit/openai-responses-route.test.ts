import worker from '../../src/index'

describe('POST /v1/responses', () => {
  const env = {
    ENVIRONMENT: 'test',
    OPENAI_API_KEY: 'upstream-secret',
  }

  const ctx = {
    waitUntil() {},
    passThroughOnException() {},
  } as unknown as ExecutionContext

  it('calls OpenAI Responses upstream and returns a response payload', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'resp_123',
          object: 'response',
          model: 'gpt-5.4-nano',
          status: 'completed',
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'omni relay ok' }],
            },
          ],
          usage: {
            input_tokens: 3,
            output_tokens: 4,
            total_tokens: 7,
          },
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
        }),
      }),
      env,
      ctx,
    )

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(response.headers.get('x-omni-upstream-latency-ms')).toBeTruthy()

    const [url] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/responses')

    const payload = await response.json() as Record<string, unknown>
    expect(payload.object).toBe('response')
    expect(payload.output_text).toBe('omni relay ok')
  })
})
