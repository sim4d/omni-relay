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

  it('maps OpenAI Responses tool-call deltas into normalized events', async () => {
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'event: response.created\n' +
            'data: {"type":"response.created","response":{"id":"resp_1","model":"glm-5.2"}}\n\n' +
            'event: response.output_item.added\n' +
            'data: {"type":"response.output_item.added","item":{"type":"function_call","call_id":"call_1","name":"lookup_weather"}}\n\n' +
            'event: response.function_call_arguments.delta\n' +
            'data: {"type":"response.function_call_arguments.delta","call_id":"call_1","delta":"{\\"city\\":\\"Pa"}\n\n' +
            'event: response.output_item.done\n' +
            'data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"call_1","name":"lookup_weather"}}\n\n' +
            'event: response.completed\n' +
            'data: {"type":"response.completed","response":{"id":"resp_1"}}\n\n',
          ),
        )
        controller.close()
      },
    })

    const events = []
    for await (const event of mapOpenAIResponsesStreamToEvents(upstream)) {
      events.push(event)
    }

    expect(events).toContainEqual({ type: 'tool_call_start', id: 'call_1', name: 'lookup_weather' })
    expect(events).toContainEqual({ type: 'tool_call_delta', id: 'call_1', argumentsDelta: '{"city":"Pa' })
    expect(events).toContainEqual({ type: 'tool_call_end', id: 'call_1' })
  })

  it('maps OpenAI Responses custom-tool-call deltas into normalized events', async () => {
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'event: response.created\n' +
            'data: {"type":"response.created","response":{"id":"resp_1","model":"glm-5.2"}}\n\n' +
            'event: response.output_item.added\n' +
            'data: {"type":"response.output_item.added","item":{"type":"custom_tool_call","id":"ctc_1","call_id":"call_1","name":"codex","input":""}}\n\n' +
            'event: response.custom_tool_call_input.delta\n' +
            'data: {"type":"response.custom_tool_call_input.delta","item_id":"ctc_1","delta":"ls"}\n\n' +
            'event: response.custom_tool_call_input.done\n' +
            'data: {"type":"response.custom_tool_call_input.done","item_id":"ctc_1","input":"ls"}\n\n' +
            'event: response.completed\n' +
            'data: {"type":"response.completed","response":{"id":"resp_1"}}\n\n',
          ),
        )
        controller.close()
      },
    })

    const events = []
    for await (const event of mapOpenAIResponsesStreamToEvents(upstream)) {
      events.push(event)
    }

    expect(events).toContainEqual({ type: 'tool_call_start', id: 'ctc_1', callId: 'call_1', name: 'codex', toolType: 'custom' })
    expect(events).toContainEqual({ type: 'tool_call_delta', id: 'ctc_1', argumentsDelta: 'ls' })
    expect(events).toContainEqual({ type: 'tool_call_end', id: 'ctc_1' })
  })

  it('renders normalized custom-tool events as OpenAI Responses SSE events', async () => {
    async function* events() {
      yield { type: 'response_start', provider: 'openai', model: 'glm-5.2' } as const
      yield { type: 'message_start', role: 'assistant' } as const
      yield { type: 'tool_call_start', id: 'ctc_1', callId: 'call_1', name: 'codex', toolType: 'custom' } as const
      yield { type: 'tool_call_delta', id: 'ctc_1', argumentsDelta: 'pwd' } as const
      yield { type: 'tool_call_end', id: 'ctc_1' } as const
      yield { type: 'response_end', finishReason: 'tool_calls' } as const
    }

    const stream = renderOpenAIResponsesStream(events())
    const body = await new Response(stream).text()

    expect(body).toContain('response.output_item.added')
    expect(body).toContain('custom_tool_call')
    expect(body).toContain('response.custom_tool_call_input.delta')
    expect(body).toContain('response.custom_tool_call_input.done')
    expect(body).toContain('"call_id":"call_1"')
  })

  it('renders normalized function-tool events with arguments completion metadata', async () => {
    async function* events() {
      yield { type: 'response_start', provider: 'openai', model: 'glm-5.2' } as const
      yield { type: 'message_start', role: 'assistant' } as const
      yield { type: 'content_delta', deltaType: 'text', text: 'Let me inspect the repo first.' } as const
      yield { type: 'tool_call_start', id: 'call_1', name: 'exec_command' } as const
      yield { type: 'tool_call_delta', id: 'call_1', argumentsDelta: '{"cmd":"ls -la"}' } as const
      yield { type: 'tool_call_end', id: 'call_1' } as const
      yield { type: 'response_end', finishReason: 'tool_calls' } as const
    }

    const stream = renderOpenAIResponsesStream(events())
    const body = await new Response(stream).text()

    const messageDoneIndex = body.indexOf('response.output_item.done')
    const functionCallAddedIndex = body.indexOf('"type":"function_call","id":"call_1"')
    const functionArgsDoneIndex = body.indexOf('response.function_call_arguments.done')

    expect(messageDoneIndex).toBeGreaterThan(-1)
    expect(functionCallAddedIndex).toBeGreaterThan(messageDoneIndex)
    expect(functionArgsDoneIndex).toBeGreaterThan(-1)
    expect(body).toContain('"output_index":1')
    expect(body).toContain('"arguments":"{\\"cmd\\":\\"ls -la\\"}"')
    expect(body).toContain('"name":"exec_command"')
  })

  it('fails clearly on invalid upstream JSON chunks', async () => {
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('event: response.created\ndata: not-json\n\n'))
        controller.close()
      },
    })

    await expect(async () => {
      for await (const _event of mapOpenAIResponsesStreamToEvents(upstream)) {
        // exhaust
      }
    }).rejects.toThrow('OpenAI Responses streaming chunk was not valid JSON')
  })
})
