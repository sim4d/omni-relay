import { renderOpenAIResponsesStream } from '../../src/protocols/openai-responses/stream'
import { mapOpenAIResponsesStreamToEvents } from '../../src/providers/openai/map-responses-stream'

describe('OpenAI responses streaming foundations', () => {
  it('maps OpenAI Responses SSE chunks into normalized events', async () => {
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'event: response.created\n' +
            'data: {"type":"response.created","response":{"id":"resp_1","model":"gpt-5.4-nano"}}\n\n' +
            'event: response.output_text.delta\n' +
            'data: {"type":"response.output_text.delta","delta":"omni "}\n\n' +
            'event: response.output_text.delta\n' +
            'data: {"type":"response.output_text.delta","delta":"relay ok"}\n\n' +
            'event: response.completed\n' +
            'data: {"type":"response.completed","response":{"id":"resp_1","usage":{"input_tokens":3,"output_tokens":2,"total_tokens":5}}}\n\n',
          ),
        )
        controller.close()
      },
    })

    const events = []
    for await (const event of mapOpenAIResponsesStreamToEvents(upstream)) {
      events.push(event)
    }

    expect(events).toEqual([
      { type: 'response_start', provider: 'openai', model: 'gpt-5.4-nano' },
      { type: 'message_start', role: 'assistant' },
      { type: 'content_delta', deltaType: 'text', text: 'omni ' },
      { type: 'content_delta', deltaType: 'text', text: 'relay ok' },
      { type: 'usage', usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } },
      { type: 'response_end', finishReason: 'stop' },
    ])
  })

  it('renders normalized events as OpenAI Responses SSE events', async () => {
    async function* events() {
      yield { type: 'response_start', provider: 'openai', model: 'gpt-5.4-nano' } as const
      yield { type: 'message_start', role: 'assistant' } as const
      yield { type: 'content_delta', deltaType: 'text', text: 'omni relay ok' } as const
      yield { type: 'response_end', finishReason: 'stop' } as const
    }

    const stream = renderOpenAIResponsesStream(events())
    const body = await new Response(stream).text()

    expect(body).toContain('response.created')
    expect(body).toContain('response.output_text.delta')
    expect(body).toContain('response.completed')
    expect(body).toContain('omni relay ok')
  })
})
