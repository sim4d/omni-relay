const encoder = new TextEncoder()

export type SSEMessage = {
  event?: string
  data: string
}

export async function* parseSSEStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<SSEMessage> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const parseBufferedEvents = function* (): Generator<SSEMessage> {
    while (true) {
      const boundary = buffer.indexOf('\n\n')
      if (boundary === -1) break

      const rawEvent = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)

      const lines = rawEvent.split(/\r?\n/)
      let eventName: string | undefined
      const dataLines: string[] = []

      for (const line of lines) {
        if (!line || line.startsWith(':')) continue
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim()
          continue
        }
        if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart())
        }
      }

      if (dataLines.length > 0) {
        yield {
          event: eventName,
          data: dataLines.join('\n'),
        }
      }
    }
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    yield* parseBufferedEvents()
  }

  buffer += decoder.decode()
  yield* parseBufferedEvents()
}

export function encodeSSEMessage(message: SSEMessage): Uint8Array {
  const lines = []
  if (message.event) lines.push(`event: ${message.event}`)
  for (const line of message.data.split('\n')) {
    lines.push(`data: ${line}`)
  }
  lines.push('', '')
  return encoder.encode(lines.join('\n'))
}

/**
 * Default interval for SSE keep-alive heartbeats, in milliseconds.
 *
 * When the upstream model has long gaps between tokens (e.g. extended
 * reasoning/thinking), the SSE connection would otherwise sit idle and the
 * downstream client (Codex CLI) may time out and stop, requiring a manual
 * "continue".  Periodic comment frames (`: keep-alive\n\n`) keep the
 * connection alive without producing visible data events, mirroring the
 * approach used by cliproxyapi's stream forwarder.
 */
const DEFAULT_KEEPALIVE_INTERVAL_MS = 15_000

/** Minimum allowable keep-alive interval to prevent event-loop starvation. */
const MIN_KEEPALIVE_INTERVAL_MS = 1_000

const KEEPALIVE_FRAME = encoder.encode(': keep-alive\n\n')

/** Safely enqueue, ignoring errors if the stream is already closed. */
function safeEnqueue(controller: ReadableStreamDefaultController<Uint8Array>, chunk: Uint8Array): boolean {
  try { controller.enqueue(chunk); return true } catch { return false }
}

/** Safely close, ignoring errors if already closed. */
function safeClose(controller: ReadableStreamDefaultController<Uint8Array>): void {
  try { controller.close() } catch { /* already closed */ }
}

type RaceResult =
  | { type: 'message'; result: IteratorResult<SSEMessage> }
  | { type: 'timeout' }
  | { type: 'error' }

export function iterableToSSEStream(
  messages: AsyncIterable<SSEMessage>,
  keepAliveIntervalMs: number = DEFAULT_KEEPALIVE_INTERVAL_MS,
): ReadableStream<Uint8Array> {
  const interval = Math.max(MIN_KEEPALIVE_INTERVAL_MS, keepAliveIntervalMs)
  const iterator = messages[Symbol.asyncIterator]()
  let cancelled = false

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        // Fetch the next message ONCE.  This promise is kept across all
        // keep-alive cycles so we never issue concurrent next() calls.
        const pendingNext = iterator.next()
        // Wrap with a rejection handler so that even if the iterator
        // rejects (e.g. upstream error / client disconnect), the derived
        // promise resolves cleanly instead of producing an unhandled
        // rejection.  This is created ONCE and reused.
        const messagePromise: Promise<RaceResult> = pendingNext.then(
          (result) => ({ type: 'message' as const, result }),
          () => ({ type: 'error' as const }),
        )

        // Race the same messagePromise against fresh timers.
        while (true) {
          if (cancelled) return

          let timeoutId: ReturnType<typeof setTimeout> | undefined

          try {
            const outcome = await Promise.race([
              messagePromise,
              new Promise<RaceResult>((resolve) => {
                timeoutId = setTimeout(() => resolve({ type: 'timeout' }), interval)
              }),
            ])

            if (outcome.type === 'timeout') {
              if (!cancelled) safeEnqueue(controller, KEEPALIVE_FRAME)
              // messagePromise is still pending — loop and race it
              // against a fresh timer.
              continue
            }

            if (outcome.type === 'error' || outcome.result.done) {
              // Close cleanly on both iterator completion and iterator rejection
              // so downstream consumers (Node Readable.fromWeb, Workers runtime)
              // see a closed stream and release resources immediately rather
              // than waiting for connection timeout.
              if (!cancelled) safeClose(controller)
              return
            }

            if (!cancelled) safeEnqueue(controller, encodeSSEMessage(outcome.result.value))
            return
          } finally {
            if (timeoutId !== undefined) clearTimeout(timeoutId)
          }
        }
      } catch {
        // Iterator threw — silently terminate.
      }
    },
    async cancel(reason) {
      cancelled = true
      if (iterator.return) {
        try { await iterator.return(reason) } catch { /* ignore */ }
      }
    },
  })
}
