import worker from '../../src/index'

describe('golden translation flows', () => {
  const ctx = {
    waitUntil() {},
    passThroughOnException() {},
  } as unknown as ExecutionContext

  it('keeps the OpenAI Responses -> Anthropic -> OpenAI Responses flow stable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'msg_golden_1',
          type: 'message',
          model: 'glm-4.7',
          content: [{ type: 'text', text: 'golden ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 4, output_tokens: 2 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ))

    const response = await worker.fetch(
      new Request('https://example.com/v1/responses', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer relay-secret',
        },
        body: JSON.stringify({
          providerHint: 'anthropic',
          model: 'glm-4.7',
          input: [{ role: 'user', content: [{ type: 'input_text', text: 'Hello' }] }],
        }),
      }),
      { ANTHROPIC_BASE_1: 'https://anthropic.example/v1', ANTHROPIC_AUTH_1: 'token', ANTHROPIC_MODEL_1: 'glm-*', RELAY_API_KEY: 'relay-secret' },
      ctx,
    )

    expect(await response.json()).toMatchObject({
      object: 'response',
      model: 'glm-4.7',
      output_text: 'golden ok',
    })
  })

  it('keeps the Anthropic Messages -> OpenAI -> Anthropic Messages flow stable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'resp_golden_1',
          object: 'response',
          model: 'glm-5.2',
          status: 'completed',
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'golden ok' }],
            },
          ],
          usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ))

    const response = await worker.fetch(
      new Request('https://example.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'relay-secret',
        },
        body: JSON.stringify({
          providerHint: 'openai',
          model: 'glm-5.2',
          max_tokens: 128,
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      }),
      { OPENAI_BASE_1: 'https://openai.example/v1', OPENAI_KEY_1: 'openai-secret', OPENAI_WIRE_1: 'responses', OPENAI_MODEL_1: 'glm-*', RELAY_API_KEY: 'relay-secret' },
      ctx,
    )

    expect(await response.json()).toMatchObject({
      type: 'message',
      model: 'glm-5.2',
      content: [{ type: 'text', text: 'golden ok' }],
    })
  })
})
