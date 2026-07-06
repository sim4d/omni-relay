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

export function iterableToSSEStream(messages: AsyncIterable<SSEMessage>): ReadableStream<Uint8Array> {
  const iterator = messages[Symbol.asyncIterator]()

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next()
      if (next.done) {
        controller.close()
        return
      }

      controller.enqueue(encodeSSEMessage(next.value))
    },
    async cancel(reason) {
      if (iterator.return) {
        await iterator.return(reason)
      }
    },
  })
}
