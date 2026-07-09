import worker from '../../src/index'

describe('custom tool support', () => {
  const ctx = {
    waitUntil() {},
    passThroughOnException() {},
  } as unknown as ExecutionContext

  it('renders OpenAI chat tool calls from an OpenAI Responses upstream tool response', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'resp_tool_1',
          object: 'response',
          model: 'gpt-5-mini',
          status: 'completed',
          output: [
            {
              type: 'function_call',
              id: 'call_1',
              call_id: 'call_1',
              name: 'lookup_weather',
              arguments: '{"city":"Paris"}',
            },
          ],
          usage: { input_tokens: 8, output_tokens: 5, total_tokens: 13 },
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
          messages: [{ role: 'user', content: 'Check weather' }],
          tools: [
            {
              type: 'function',
              function: {
                name: 'lookup_weather',
                parameters: { type: 'object', properties: { city: { type: 'string' } } },
              },
            },
          ],
        }),
      }),
      { OPENAI_BASE_1: 'https://openai.example/v1', OPENAI_KEY_1: 'openai-secret', OPENAI_WIRE_1: 'responses', OPENAI_MODEL_1: 'gpt-*', RELAY_API_KEY: 'relay-secret' },
      ctx,
    )

    const payload = await response.json() as Record<string, unknown>
    const choices = payload.choices as Array<Record<string, unknown>>
    const message = choices[0]?.message as Record<string, unknown>
    const toolCalls = message.tool_calls as Array<Record<string, unknown>>

    expect(response.status).toBe(200)
    expect(choices[0]?.finish_reason).toBe('tool_calls')
    expect(toolCalls[0]?.id).toBe('call_1')
  })

  it('renders Anthropic tool_use blocks from an OpenAI Responses upstream function call', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'resp_tool_1',
          object: 'response',
          model: 'gpt-5.4-nano',
          status: 'completed',
          output: [
            {
              type: 'function_call',
              id: 'fc_1',
              call_id: 'fc_1',
              name: 'lookup_weather',
              arguments: '{"city":"Paris"}',
            },
          ],
          usage: { input_tokens: 6, output_tokens: 4, total_tokens: 10 },
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
        },
        body: JSON.stringify({
          model: 'gpt-5.4-nano',
          max_tokens: 128,
          messages: [{ role: 'user', content: 'Check weather' }],
          tools: [{ name: 'lookup_weather', input_schema: { type: 'object', properties: { city: { type: 'string' } } } }],
        }),
      }),
      { OPENAI_BASE_1: 'https://openai.example/v1', OPENAI_KEY_1: 'openai-secret', OPENAI_WIRE_1: 'responses', OPENAI_MODEL_1: 'gpt-*', RELAY_API_KEY: 'relay-secret' },
      ctx,
    )

    const payload = await response.json() as Record<string, unknown>
    const content = payload.content as Array<Record<string, unknown>>

    expect(response.status).toBe(200)
    expect(content[0]?.type).toBe('tool_use')
    expect(content[0]?.id).toBe('fc_1')
    expect(content[0]?.name).toBe('lookup_weather')
  })

  it('renders OpenAI chat tool calls from an Anthropic upstream tool_use block in cross-provider mode', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'msg_tool_1',
          type: 'message',
          model: 'claude-sonnet-4-0',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'lookup_weather',
              input: { city: 'Paris' },
            },
          ],
          stop_reason: 'tool_use',
          usage: { input_tokens: 4, output_tokens: 3 },
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
          model: 'claude-sonnet-4-0',
          messages: [{ role: 'user', content: 'Check weather' }],
          tools: [
            {
              type: 'function',
              function: {
                name: 'lookup_weather',
                parameters: { type: 'object', properties: { city: { type: 'string' } } },
              },
            },
          ],
        }),
      }),
      { ANTHROPIC_BASE_1: 'https://anthropic.example/v1', ANTHROPIC_AUTH_1: 'anthropic-secret', ANTHROPIC_MODEL_1: 'claude-*', RELAY_API_KEY: 'relay-secret' },
      ctx,
    )

    const payload = await response.json() as Record<string, unknown>
    const choices = payload.choices as Array<Record<string, unknown>>
    const message = choices[0]?.message as Record<string, unknown>
    const toolCalls = message.tool_calls as Array<Record<string, unknown>>

    expect(response.status).toBe(200)
    expect(toolCalls[0]?.id).toBe('toolu_1')
  })
})
