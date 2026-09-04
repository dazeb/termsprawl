// Phase 11 Task 11.1 — terminal frame protocol + output coalescer. The JSON
// application protocol that rides INSIDE the already-E2E-encrypted relay
// envelope (the relay service never sees it), plus a per-terminal coalescer
// so tmux stream output doesn't flush one envelope per byte. Pure TS,
// Electron-free; pairing UI serialises/parses these frames and pipe tmux
// output through a coalescer before pushing it over the tunnel.
//
// Clean-room: written fresh for termsprawl; nothing copied from the fork or
// any other project.

export type RelayTermFrame =
  | { v: 1; k: 'list' }
  | { v: 1; k: 'term-list'; terms: Array<{ id: string; title: string }> }
  | { v: 1; k: 'attach'; term: string }
  | { v: 1; k: 'detach'; term: string }
  | { v: 1; k: 'in'; term: string; data: string }
  | { v: 1; k: 'out'; term: string; data: string }
  | { v: 1; k: 'resized'; term: string; cols: number; rows: number }

/** Parse a raw JSON frame. Returns null for garbage, unknown k, or v !== 1. */
export function parseRelayTermFrame(raw: string): RelayTermFrame | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    return isRelayTermFrame(parsed) ? parsed : null
  } catch {
    return null
  }
}

const OUT_KEYS = new Set(['list', 'term-list', 'attach', 'detach', 'in', 'out', 'resized'])

function isRelayTermFrame(value: unknown): value is RelayTermFrame {
  if (typeof value !== 'object' || value === null) return false
  const o = value as Record<string, unknown>
  if (o.v !== 1 || typeof o.k !== 'string' || !OUT_KEYS.has(o.k)) return false
  switch (o.k) {
    case 'list':
      return true
    case 'term-list':
      return (
        Array.isArray(o.terms) &&
        (o.terms as unknown[]).every(
          (t) =>
            typeof t === 'object' &&
            t !== null &&
            typeof (t as Record<string, unknown>).id === 'string' &&
            typeof (t as Record<string, unknown>).title === 'string'
        )
      )
    case 'attach':
    case 'detach':
      return typeof o.term === 'string'
    case 'in':
    case 'out':
      return typeof o.term === 'string' && typeof o.data === 'string'
    case 'resized':
      return typeof o.term === 'string' && typeof o.cols === 'number' && typeof o.rows === 'number'
  }
  return false
}

const DEFAULT_INTERVAL_MS = 16
const DEFAULT_MAX_BYTES = 32 * 1024

export interface TermCoalescer {
  push(frame: Extract<RelayTermFrame, { k: 'out' }>): void
  flushNow(): void
  stop(): void
}

interface CoalescerOpts {
  intervalMs?: number
  maxBytes?: number
}

/**
 * Buffers 'out' frames and flushes them in one batch, coalescing consecutive
 * frames for the same terminal into a single frame whose data stays within
 * maxBytes (default 32 KiB). A single frame whose data alone exceeds maxBytes
 * flushes immediately. The internal timer (default intervalMs 16) only fires
 * flushNow() when the buffer is non-empty.
 */
export function createTermCoalescer(
  flush: (frames: RelayTermFrame[]) => void,
  opts?: CoalescerOpts
): TermCoalescer {
  const intervalMs = opts?.intervalMs ?? DEFAULT_INTERVAL_MS
  const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES

  let buffer: RelayTermFrame[] = []
  let timer: ReturnType<typeof setInterval> | null = null

  function schedule(): void {
    if (timer !== null) return
    timer = setInterval(() => {
      if (buffer.length > 0) flushNow()
    }, intervalMs)
  }

  function push(frame: Extract<RelayTermFrame, { k: 'out' }>): void {
    if (frame.data.length > maxBytes) {
      // Oversized payload can't be merged; emit it immediately, then carry on
      // buffering anything already queued behind it.
      const head: RelayTermFrame[] = buffer
      buffer = []
      head.push(frame)
      flush(head)
      return
    }

    const tail = buffer[buffer.length - 1]
    if (tail !== undefined && tail.k === 'out' && tail.term === frame.term) {
      const merged = tail.data.length + frame.data.length
      if (merged <= maxBytes) {
        // Replace the last entry in place — the coalesced frame keeps its
        // original position in the batch.
        buffer[buffer.length - 1] = { ...tail, data: tail.data + frame.data }
        schedule()
        return
      }
    }

    buffer.push(frame)
    schedule()
  }

  function flushNow(): void {
    if (buffer.length === 0) return
    const batch: RelayTermFrame[] = buffer
    buffer = []
    flush(batch)
  }

  function stop(): void {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  return { push, flushNow, stop }
}