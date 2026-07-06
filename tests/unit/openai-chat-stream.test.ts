import { renderOpenAIChatStream } from '../../src/protocols/openai-chat/stream'
import { mapOpenAIChatStreamToEvents } from '../../src/providers/openai/map-stream'

describe('OpenAI chat streaming foundations', () => {
  it('maps OpenAI chat SSE chunks into normalized events', async () => {
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"id":"chatcmpl_stream_1","object":"chat.completion.chunk","model":"gpt-5-mini","choices":[{"index":0,"delta":{"content":"omni "},"finish_reason":null}]}\n\n' +
            'data: {"id":"chatcmpl_stream_1","object":"chat.completion.chunk","model":"gpt-5-mini","choices":[{"index":0,"delta":{"content":"relay ok"},"finish_reason":"stop"}]}\n\n' +
            'data: [DONE]\n\n',
          ),
        )
        controller.close()
      },
    })

    const events = []
    for await (const event of mapOpenAIChatStreamToEvents(upstream)) {
      events.push(event)
    }

    expect(events).toEqual([
      { type: 'response_start', provider: 'openai', model: 'gpt-5-mini' },
      { type: 'message_start', role: 'assistant' },
      { type: 'content_delta', deltaType: 'text', text: 'omni ' },
      { type: 'content_delta', deltaType: 'text', text: 'relay ok' },
      { type: 'response_end', finishReason: 'stop' },
    ])
  })

  it('renders normalized events as OpenAI chat SSE chunks', async () => {
    async function* events() {
      yield { type: 'response_start', provider: 'openai', model: 'gpt-5-mini' } as const
      yield { type: 'message_start', role: 'assistant' } as const
      yield { type: 'content_delta', deltaType: 'text', text: 'omni ' } as const
      yield { type: 'content_delta', deltaType: 'text', text: 'relay ok' } as const
      yield { type: 'response_end', finishReason: 'stop' } as const
    }

    const stream = renderOpenAIChatStream(events())
    const body = await new Response(stream).text()

    expect(body).toContain('chat.completion.chunk')
    expect(body).toContain('omni ')
    expect(body).toContain('relay ok')
    expect(body).toContain('[DONE]')
  })

  it('handles interrupted upstream streams without buffering the whole response', async () => {
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"id":"chatcmpl_stream_1","object":"chat.completion.chunk","model":"gpt-5-mini","choices":[{"index":0,"delta":{"content":"partial"},"finish_reason":null}]}\n\n',
          ),
        )
        controller.close()
      },
    })

    const events = []
    for await (const event of mapOpenAIChatStreamToEvents(upstream)) {
      events.push(event)
    }

    expect(events).toEqual([
      { type: 'response_start', provider: 'openai', model: 'gpt-5-mini' },
      { type: 'message_start', role: 'assistant' },
      { type: 'content_delta', deltaType: 'text', text: 'partial' },
    ])
  })
})
