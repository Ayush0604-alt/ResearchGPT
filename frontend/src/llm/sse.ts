/** Split a server-sent-events buffer into complete `data:` payloads. */
export function takeSSEEvents(buffer: string): { events: string[]; rest: string } {
  const blocks = buffer.split(/\r?\n\r?\n/)
  const rest = blocks.pop() ?? ''
  const events = blocks
    .map((block) =>
      block
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join(''),
    )
    .filter(Boolean)
  return { events, rest }
}

/** Yield each `data:` payload of an SSE response body as it arrives. */
export async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    buffer += done ? decoder.decode() + '\n\n' : decoder.decode(value, { stream: true })
    const { events, rest } = takeSSEEvents(buffer)
    buffer = rest
    yield* events
    if (done) return
  }
}
