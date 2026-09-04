// Phase 11 Task 11.1 — terminal frame protocol TDD. The JSON application
// protocol carried INSIDE the already-E2E-encrypted relay envelope (the relay
// service never sees it), plus a per-terminal output coalescer so tmux stream
// output doesn't flush one envelope per byte. Pure TS, Electron-free.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createTermCoalescer,
  parseRelayTermFrame,
  type RelayTermFrame
} from './relay-term'

describe('parseRelayTermFrame', () => {
  it('parses the list frame', () => {
    const f = parseRelayTermFrame('{"v":1,"k":"list"}')
    expect(f).toEqual({ v: 1, k: 'list' })
  })

  it('parses the term-list frame', () => {
    const raw = '{"v":1,"k":"term-list","terms":[{"id":"a","title":"A"},{"id":"b","title":"B"}]}'
    const f = parseRelayTermFrame(raw)
    expect(f).toEqual({
      v: 1,
      k: 'term-list',
      terms: [
        { id: 'a', title: 'A' },
        { id: 'b', title: 'B' }
      ]
    })
  })

  it('parses the attach frame', () => {
    const f = parseRelayTermFrame('{"v":1,"k":"attach","term":"a"}')
    expect(f).toEqual({ v: 1, k: 'attach', term: 'a' })
  })

  it('parses the detach frame', () => {
    const f = parseRelayTermFrame('{"v":1,"k":"detach","term":"a"}')
    expect(f).toEqual({ v: 1, k: 'detach', term: 'a' })
  })

  it('parses the in frame', () => {
    const f = parseRelayTermFrame('{"v":1,"k":"in","term":"a","data":"ls\\n"}')
    expect(f).toEqual({ v: 1, k: 'in', term: 'a', data: 'ls\n' })
  })

  it('parses the out frame', () => {
    const f = parseRelayTermFrame('{"v":1,"k":"out","term":"a","data":"hello"}')
    expect(f).toEqual({ v: 1, k: 'out', term: 'a', data: 'hello' })
  })

  it('parses the resized frame', () => {
    const f = parseRelayTermFrame('{"v":1,"k":"resized","term":"a","cols":80,"rows":24}')
    expect(f).toEqual({ v: 1, k: 'resized', term: 'a', cols: 80, rows: 24 })
  })

  it('returns null for non-JSON garbage', () => {
    expect(parseRelayTermFrame('garbage')).toBeNull()
    expect(parseRelayTermFrame('')).toBeNull()
    expect(parseRelayTermFrame('weird { json')).toBeNull()
  })

  it('returns null for an unknown key', () => {
    expect(parseRelayTermFrame('{"k":"nope","v":1}')).toBeNull()
  })

  it('returns null for an unsupported version', () => {
    expect(parseRelayTermFrame('{"k":"list","v":2}')).toBeNull()
    expect(parseRelayTermFrame('{"k":"out","v":1,"term":"a","data":"x"}' + ' but see v2')).toBeNull()
  })
})

describe('createTermCoalescer', () => {
  let flush: ReturnType<typeof vi.fn<(frames: RelayTermFrame[]) => void>>
  let coalescer: ReturnType<typeof createTermCoalescer>

  beforeEach(() => {
    vi.useFakeTimers()
    flush = vi.fn<(frames: RelayTermFrame[]) => void>()
  })

  afterEach(() => {
    coalescer?.stop()
    vi.useRealTimers()
  })

  it('flushes buffered frames for different terms when the clock advances', () => {
    coalescer = createTermCoalescer(flush, { intervalMs: 16 })
    coalescer.push({ v: 1, k: 'out', term: 'a', data: 'x' })
    coalescer.push({ v: 1, k: 'out', term: 'b', data: 'y' })
    expect(flush).not.toHaveBeenCalled()

    vi.advanceTimersByTime(16)
    expect(flush).toHaveBeenCalledTimes(1)
    const batch = flush.mock.calls[0][0] as RelayTermFrame[]
    expect(batch).toEqual([
      { v: 1, k: 'out', term: 'a', data: 'x' },
      { v: 1, k: 'out', term: 'b', data: 'y' }
    ])

    // buffer is now empty: another tick must not re-flush the same frames
    flush.mockClear()
    vi.advanceTimersByTime(16)
    expect(flush).not.toHaveBeenCalled()
  })

  it('merges consecutive out frames for the same term under the cap', () => {
    coalescer = createTermCoalescer(flush, { intervalMs: 16 })
    coalescer.push({ v: 1, k: 'out', term: 'a', data: 'one' })
    coalescer.push({ v: 1, k: 'out', term: 'a', data: ' two' })
    coalescer.push({ v: 1, k: 'out', term: 'b', data: 'z' })

    vi.advanceTimersByTime(16)
    const batch = flush.mock.calls[0][0] as RelayTermFrame[]
    expect(batch).toEqual([
      { v: 1, k: 'out', term: 'a', data: 'one two' },
      { v: 1, k: 'out', term: 'b', data: 'z' }
    ])
  })

  it('does not merge when the merged size would exceed maxBytes', () => {
    coalescer = createTermCoalescer(flush, { intervalMs: 16, maxBytes: 8 })
    // 'abcdefgh' is 8 bytes; merging the second would make it 16 > 8
    coalescer.push({ v: 1, k: 'out', term: 'a', data: 'abcdefgh' })
    coalescer.push({ v: 1, k: 'out', term: 'a', data: 'ijkl' })

    vi.advanceTimersByTime(16)
    const batch = flush.mock.calls[0][0] as RelayTermFrame[]
    expect(batch).toEqual([
      { v: 1, k: 'out', term: 'a', data: 'abcdefgh' },
      { v: 1, k: 'out', term: 'a', data: 'ijkl' }
    ])
  })

  it('flushes an oversize single frame immediately without the timer', () => {
    coalescer = createTermCoalescer(flush, { intervalMs: 16, maxBytes: 8 })
    coalescer.push({ v: 1, k: 'out', term: 'a', data: 'way too long to fit' })
    expect(flush).toHaveBeenCalledTimes(1)
    expect(flush.mock.calls[0][0]).toEqual([{ v: 1, k: 'out', term: 'a', data: 'way too long to fit' }])

    // and an unrelated buffered frame is still flushed by the timer afterwards
    flush.mockClear()
    coalescer.push({ v: 1, k: 'out', term: 'b', data: 'z' })
    vi.advanceTimersByTime(16)
    expect(flush).toHaveBeenCalledTimes(1)
    expect(flush.mock.calls[0][0]).toEqual([{ v: 1, k: 'out', term: 'b', data: 'z' }])
  })

  it('manual flushNow works and is a no-op when empty', () => {
    coalescer = createTermCoalescer(flush, { intervalMs: 16 })
    coalescer.flushNow()
    expect(flush).not.toHaveBeenCalled()

    coalescer.push({ v: 1, k: 'out', term: 'a', data: 'x' })
    coalescer.flushNow()
    expect(flush).toHaveBeenCalledTimes(1)
    expect(flush.mock.calls[0][0]).toEqual([{ v: 1, k: 'out', term: 'a', data: 'x' }])
  })

  it('does not fire after stop()', () => {
    coalescer = createTermCoalescer(flush, { intervalMs: 16 })
    coalescer.push({ v: 1, k: 'out', term: 'a', data: 'x' })
    coalescer.stop()
    coalescer.stop() // idempotent
    vi.advanceTimersByTime(100)
    expect(flush).not.toHaveBeenCalled()
  })
})