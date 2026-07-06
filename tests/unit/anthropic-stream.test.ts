import { renderAnthropicMessagesStream } from '../../src/protocols/anthropic-messages/stream'
import { mapAnthropicStreamToEvents } from '../../src/providers/anthropic/map-stream'

describe('Anthropic streaming foundations', () => {
  it('maps Anthropic SSE chunks into normalized events', async () => {
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'event: message_start\n' +
            'data: {"type":"message_start","message":{"id":"msg_1","model":"claude-sonnet-4-0"}}\n\n' +
            'event: content_block_start\n' +
            'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
            'event: content_block_delta\n' +
            'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"omni "}}\n\n' +
            'event: content_block_delta\n' +
            'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"relay ok"}}\n\n' +
            'event: message_delta\n' +
            'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":4,"output_tokens":2}}\n\n' +
            'event: message_stop\n' +
            'data: {"type":"message_stop"}\n\n',
          ),
        )
        controller.close()
      },
    })

    const events = []
    for await (const event of mapAnthropicStreamToEvents(upstream)) {
      events.push(event)
    }

    expect(events).toEqual([
      { type: 'response_start', provider: 'anthropic', model: 'claude-sonnet-4-0' },
      { type: 'message_start', role: 'assistant' },
      { type: 'content_delta', deltaType: 'text', text: 'omni ' },
      { type: 'content_delta', deltaType: 'text', text: 'relay ok' },
      { type: 'usage', usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 } },
      { type: 'response_end', finishReason: 'end_turn' },
    ])
  })

  it('renders normalized events as Anthropic SSE events', async () => {
    async function* events() {
      yield { type: 'response_start', provider: 'anthropic', model: 'claude-sonnet-4-0' } as const
      yield { type: 'message_start', role: 'assistant' } as const
      yield { type: 'content_delta', deltaType: 'text', text: 'omni relay ok' } as const
      yield { type: 'response_end', finishReason: 'end_turn' } as const
    }

    const stream = renderAnthropicMessagesStream(events())
    const body = await new Response(stream).text()

    expect(body).toContain('message_start')
    expect(body).toContain('content_block_delta')
    expect(body).toContain('message_stop')
    expect(body).toContain('omni relay ok')
  })

  it('maps Anthropic tool-call deltas into normalized events', async () => {
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'event: message_start\n' +
            'data: {"type":"message_start","message":{"id":"msg_1","model":"glm-4.7"}}\n\n' +
            'event: content_block_start\n' +
            'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tool_1","name":"lookup_weather"}}\n\n' +
            'event: content_block_delta\n' +
            'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\":\\"Pa"}}\n\n' +
            'event: content_block_stop\n' +
            'data: {"type":"content_block_stop","index":0}\n\n' +
            'event: message_stop\n' +
            'data: {"type":"message_stop"}\n\n',
          ),
        )
        controller.close()
      },
    })

    const events = []
    for await (const event of mapAnthropicStreamToEvents(upstream)) {
      events.push(event)
    }

    expect(events).toContainEqual({ type: 'tool_call_start', id: 'tool_1', name: 'lookup_weather' })
    expect(events).toContainEqual({ type: 'tool_call_delta', id: 'tool_1', argumentsDelta: '{"city":"Pa' })
    expect(events).toContainEqual({ type: 'tool_call_end', id: 'tool_1' })
  })

  it('fails clearly on invalid upstream JSON chunks', async () => {
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('event: message_start\ndata: not-json\n\n'))
        controller.close()
      },
    })

    await expect(async () => {
      for await (const _event of mapAnthropicStreamToEvents(upstream)) {
        // exhaust
      }
    }).rejects.toThrow('Anthropic streaming chunk was not valid JSON')
  })
})
