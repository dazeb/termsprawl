// Phase 11 Task 11.4 — chat driver v2 core: shared SSE reader. Electron-free,
// zero dependencies. Parses text/event-stream from a fetch ReadableStream by
// hand: event blocks end at a blank line, 'data:' lines accumulate,
// 'event:' sets the event name, ':' lines are keepalive comments. Tolerates
// CRLF line endings and a missing final blank line.
//
// Clean-room: written fresh for termsprawl; nothing copied from the fork or
// any other project.

export interface SseMessage {
  event?: string
  data: string
}

/** Yield SSE messages from a response body stream. Throws AbortError (via the
 * caller's signal) so adapters can translate an abort into a stopped event. */
export async function* readSse(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncGenerator<SseMessage> {
  const decoder = new TextDecoder()
  let buffer = ''
  let eventName: string | undefined
  const dataLines: string[] = []

  const reader = body.getReader()
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).replace(/\r$/, '')
        buffer = buffer.slice(nl + 1)
        if (line === '') {
          if (eventName !== undefined || dataLines.length > 0) {
            yield { event: eventName, data: dataLines.join('\n') }
            eventName = undefined
            dataLines.length = 0
          }
        } else if (line.startsWith(':')) {
          // keepalive comment — ignore
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart())
        } else if (line.startsWith('event:')) {
          eventName = line.slice(6).trim()
        }
        // other fields (id:, retry:) are ignored
      }
    }
    // flush a trailing block without a final blank line
    if (eventName !== undefined || dataLines.length > 0) {
      yield { event: eventName, data: dataLines.join('\n') }
    }
  } finally {
    try {
      await reader.cancel()
    } catch {
      // stream already closed
    }
  }
}
