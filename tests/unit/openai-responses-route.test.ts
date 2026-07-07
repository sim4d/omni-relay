import worker from '../../src/index'

describe('POST /v1/responses', () => {
  const env = {
    OPENAI_API_KEY: 'upstream-secret',
    OPENAI_BASE_URL: 'https://openai.example/v1',
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
    expect(url).toBe('https://openai.example/v1/responses')

    const payload = await response.json() as Record<string, unknown>
    expect(payload.object).toBe('response')
    expect(payload.output_text).toBe('omni relay ok')
  })

  it('preserves custom tool calls on the OpenAI Responses same-provider route', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'resp_custom_1',
          object: 'response',
          model: 'glm-5.2',
          status: 'completed',
          output: [
            {
              type: 'custom_tool_call',
              id: 'ctc_1',
              call_id: 'call_1',
              name: 'codex',
              input: 'pwd',
            },
          ],
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
          model: 'glm-5.2',
          input: [{ role: 'user', content: [{ type: 'input_text', text: 'Hello' }] }],
          tools: [{ type: 'custom', name: 'codex', description: 'Run commands' }],
        }),
      }),
      env,
      ctx,
    )

    expect(response.status).toBe(200)
    const payload = await response.json() as Record<string, unknown>
    const output = payload.output as Array<Record<string, unknown>>
    expect(output[0]?.type).toBe('custom_tool_call')
    expect(output[0]?.name).toBe('codex')
    expect(output[0]?.input).toBe('pwd')
  })

  it('can serve the OpenAI Responses route through an OpenAI chat-completions upstream', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'chatcmpl_123',
          object: 'chat.completion',
          model: 'glm-5.2',
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: {
                role: 'assistant',
                content: 'omni relay ok via chat upstream',
              },
            },
          ],
          usage: {
            prompt_tokens: 3,
            completion_tokens: 4,
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
          model: 'glm-5.2',
          input: [{ role: 'user', content: [{ type: 'input_text', text: 'Hello' }] }],
          tools: [
            { type: 'custom', name: 'apply_patch', description: 'Freeform patch tool' },
            { type: 'namespace', name: 'multi_agent_v1', tools: [{ type: 'function', name: 'spawn_agent', parameters: { type: 'object' } }] },
          ],
        }),
      }),
      {
        ...env,
        OPENAI_WIRE_API: 'chat_completions',
      },
      ctx,
    )

    expect(response.status).toBe(200)
    const [url] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit]
    expect(url).toBe('https://openai.example/v1/chat/completions')
    const payload = await response.json() as Record<string, unknown>
    expect(payload.object).toBe('response')
    expect(payload.output_text).toBe('omni relay ok via chat upstream')
  })

  it('fails clearly when OPENAI_BASE_URL is missing', async () => {
    vi.stubGlobal('fetch', vi.fn())

    const response = await worker.fetch(
      new Request('https://example.com/v1/responses', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-5.4-nano',
          input: [{ role: 'user', content: [{ type: 'input_text', text: 'Hello' }] }],
        }),
      }),
      {
        OPENAI_API_KEY: 'upstream-secret',
      },
      ctx,
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'internal_error',
        message: expect.stringContaining('OPENAI_BASE_URL'),
      },
    })
    expect(fetch).not.toHaveBeenCalled()
  })
})
