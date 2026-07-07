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
      { ANTHROPIC_API_KEY: 'anthropic-secret', ANTHROPIC_BASE_URL: 'https://anthropic.example/v1' },
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
      { OPENAI_API_KEY: 'openai-secret', OPENAI_BASE_URL: 'https://openai.example/v1' },
      ctx,
    )

    expect(response.status).toBe(200)
    const [, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.text).toBeTruthy()
  })

  it('allows OpenAI Responses provider-native tools on the same-provider route', async () => {
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
              input: 'ls',
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
          tools: [
            { type: 'custom', name: 'codex', description: 'Run local commands' },
            { type: 'namespace', name: 'multi_agent_v1', tools: [{ type: 'function', name: 'spawn_agent', parameters: { type: 'object' } }] },
            { type: 'web_search', external_web_access: false },
          ],
          tool_choice: { type: 'custom', name: 'codex' },
          reasoning: { effort: 'high' },
        }),
      }),
      { OPENAI_API_KEY: 'openai-secret', OPENAI_BASE_URL: 'https://openai.example/v1' },
      ctx,
    )

    expect(response.status).toBe(200)
    const [, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.tools).toEqual([
      { type: 'custom', name: 'codex', description: 'Run local commands' },
      { type: 'namespace', name: 'multi_agent_v1', tools: [{ type: 'function', name: 'spawn_agent', parameters: { type: 'object' } }] },
      { type: 'web_search', external_web_access: false },
    ])
    expect(body.tool_choice).toEqual({ type: 'custom', name: 'codex' })
    expect(body.reasoning).toEqual({ effort: 'high' })
  })

  it('rejects OpenAI Responses provider-native tools on a cross-provider route', async () => {
    vi.stubGlobal('fetch', vi.fn())

    const response = await worker.fetch(
      new Request('https://example.com/v1/responses', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          providerHint: 'anthropic',
          model: 'glm-4.7',
          input: [{ role: 'user', content: [{ type: 'input_text', text: 'Hello' }] }],
          tools: [
            { type: 'custom', name: 'codex', description: 'Run local commands' },
            { type: 'namespace', name: 'multi_agent_v1', tools: [{ type: 'function', name: 'spawn_agent', parameters: { type: 'object' } }] },
            { type: 'web_search', external_web_access: false },
          ],
        }),
      }),
      { ANTHROPIC_API_KEY: 'anthropic-secret', ANTHROPIC_BASE_URL: 'https://anthropic.example/v1' },
      ctx,
    )

    expect(response.status).toBe(422)
  })

  it('rejects cross-provider anthropic thinking blocks on an OpenAI-selected route', async () => {
    vi.stubGlobal('fetch', vi.fn())

    const response = await worker.fetch(
      new Request('https://example.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          providerHint: 'openai',
          model: 'glm-5.2',
          max_tokens: 64,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'thinking', text: 'internal reasoning' },
              ],
            },
          ],
        }),
      }),
      { OPENAI_API_KEY: 'openai-secret', OPENAI_BASE_URL: 'https://openai.example/v1' },
      ctx,
    )

    expect(response.status).toBe(422)
  })

  it('rejects cross-provider multimodal OpenAI content blocks on an Anthropic-selected route', async () => {
    vi.stubGlobal('fetch', vi.fn())

    const response = await worker.fetch(
      new Request('https://example.com/v1/responses', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          providerHint: 'anthropic',
          model: 'glm-4.7',
          input: [
            {
              role: 'user',
              content: [
                { type: 'input_image', image_url: 'https://example.com/cat.png' },
              ],
            },
          ],
        }),
      }),
      { ANTHROPIC_API_KEY: 'anthropic-secret', ANTHROPIC_BASE_URL: 'https://anthropic.example/v1' },
      ctx,
    )

    expect(response.status).toBe(422)
  })
})
