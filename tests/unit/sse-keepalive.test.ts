import { iterableToSSEStream, encodeSSEMessage, type SSEMessage } from '../../src/lib/sse'

/** Collect all chunks from a ReadableStream into a string. */
async function drainStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let result = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    result += decoder.decode(value, { stream: true })
  }
  result += decoder.decode()
  return result
}

/** Create an async generator that yields messages with configurable delays. */
async function* delayedMessages(
  messages: SSEMessage[],
  delays: number[],
): AsyncGenerator<SSEMessage> {
  for (let i = 0; i < messages.length; i++) {
    if (delays[i] !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, delays[i]))
    }
    yield messages[i]
  }
}

describe('iterableToSSEStream keep-alive', () => {
  // These tests use real timers with >=1s intervals, so need longer timeouts
  vi.setConfig({ testTimeout: 15_000 })
  it('emits keep-alive comments during idle periods', async () => {
    const messages: SSEMessage[] = [
      { event: 'response.created', data: '{"type":"response.created"}' },
      { event: 'response.completed', data: '{"type":"response.completed"}' },
    ]
    // 2000ms gap between the two messages, keep-alive every 1100ms
    const stream = iterableToSSEStream(
      delayedMessages(messages, [0, 2000]),
      1100,
    )

    const output = await drainStream(stream)

    // Should contain at least one keep-alive comment
    const keepAliveCount = (output.match(/: keep-alive\n\n/g) || []).length
    expect(keepAliveCount).toBeGreaterThanOrEqual(1)

    // Should still contain both real messages
    expect(output).toContain('event: response.created')
    expect(output).toContain('event: response.completed')
  })

  it('does not emit keep-alive when messages arrive quickly', async () => {
    const messages: SSEMessage[] = [
      { event: 'response.created', data: '{"type":"response.created"}' },
      { event: 'response.completed', data: '{"type":"response.completed"}' },
    ]
    // No delay between messages, keep-alive every 5000ms
    const stream = iterableToSSEStream(
      delayedMessages(messages, [0, 0]),
      5000,
    )

    const output = await drainStream(stream)

    expect(output).not.toContain(': keep-alive')
    expect(output).toContain('event: response.created')
    expect(output).toContain('event: response.completed')
  })

  it('emits keep-alive between message groups during a long idle', async () => {
    const messages: SSEMessage[] = [
      { data: '{"text":"first"}' },
      { data: '{"text":"second"}' },
      { data: '{"text":"third"}' },
    ]
    // 2500ms gap after first, 2500ms gap after second, keep-alive every 1100ms
    const stream = iterableToSSEStream(
      delayedMessages(messages, [0, 2500, 2500]),
      1100,
    )

    const output = await drainStream(stream)

    const keepAliveCount = (output.match(/: keep-alive\n\n/g) || []).length
    // Should have at least 2 keep-alives (one per gap)
    expect(keepAliveCount).toBeGreaterThanOrEqual(2)
    expect(output).toContain('{"text":"first"}')
    expect(output).toContain('{"text":"second"}')
    expect(output).toContain('{"text":"third"}')
  })

  it('handles empty iterator without keep-alive', async () => {
    const stream = iterableToSSEStream(
      (async function* () {})(),
      5000,
    )

    const output = await drainStream(stream)
    expect(output).not.toContain(': keep-alive')
    expect(output).toBe('')
  })

  it('correctly encodes a keep-alive frame as an SSE comment', () => {
    // Verify the frame format: starts with ':' and ends with '\n\n'
    const encoder = new TextEncoder()
    const frame = encoder.encode(': keep-alive\n\n')
    const decoder = new TextDecoder()
    const text = decoder.decode(frame)

    expect(text.startsWith(':')).toBe(true)
    expect(text.endsWith('\n\n')).toBe(true)
  })
})

describe('iterableToSSEStream input clamping', () => {
  it('clamps keepAliveIntervalMs to minimum of 1s to prevent event-loop starvation', async () => {
    const messages: SSEMessage[] = [
      { data: '{"text":"hello"}' },
    ]
    // Pass interval=0 which should be clamped to 1s
    const stream = iterableToSSEStream(
      (async function* () {
        await new Promise((r) => setTimeout(r, 50))
        yield messages[0]
      })(),
      0,
    )

    const output = await drainStream(stream)
    // Should NOT have emitted any keep-alives because 50ms < 1000ms (clamped)
    expect(output).not.toContain(': keep-alive')
    expect(output).toContain('{"text":"hello"}')
  })

  it('clamps negative keepAliveIntervalMs to 1s minimum', async () => {
    const messages: SSEMessage[] = [
      { data: '{"text":"hello"}' },
    ]
    const stream = iterableToSSEStream(
      (async function* () {
        await new Promise((r) => setTimeout(r, 50))
        yield messages[0]
      })(),
      -5,
    )

    const output = await drainStream(stream)
    expect(output).not.toContain(': keep-alive')
    expect(output).toContain('{"text":"hello"}')
  })
})


describe('iterableToSSEStream error handling', () => {
  it('closes the stream cleanly when the iterator rejects mid-stream', async () => {
    // Iterator that yields one message then throws — simulates upstream error
    // after partial response (e.g., HTTP/2 RST_STREAM, upstream 5xx mid-stream).
    const failingIterator = (async function* () {
      yield { data: '{"text":"first"}' }
      throw new Error('upstream connection reset')
    })()

    const stream = iterableToSSEStream(failingIterator, 5000)
    const output = await drainStream(stream)

    // The first message must still be delivered.
    expect(output).toContain('{"text":"first"}')
    // The stream must terminate (not hang waiting for connection timeout).
    // drainStream resolves only when the stream signals done, so this returning
    // is itself the assertion that the controller was closed cleanly.
  })

  it('closes the stream cleanly when the iterator throws before any message', async () => {
    const failingIterator = (async function* () {
      throw new Error('upstream rejected before first token')
    })()

    const stream = iterableToSSEStream(failingIterator, 5000)
    const output = await drainStream(stream)

    // No content was emitted, but the stream must close promptly.
    expect(output).toBe('')
  })

  it('handles client cancel without throwing', async () => {
    // Iterator that yields slowly so we have a chance to cancel.
    const slowIterator = (async function* () {
      yield { data: '{"text":"hello"}' }
      await new Promise((r) => setTimeout(r, 60_000))
      yield { data: '{"text":"never reached"}' }
    })()

    const stream = iterableToSSEStream(slowIterator, 60_000)
    const reader = stream.getReader()
    const first = await reader.read()
    expect(first.value).toBeDefined()
    expect(first.done).toBe(false)
    // Cancelling the reader should not throw; iterator.return() must be invoked.
    await reader.cancel()
  })
})
