import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionNameTracker } from './session-name'

// The tracker reads the agent transcript's session_name per session, throttled
// and change-detected: hook events arrive constantly (every tool call), but we
// only broadcast a session-name event when the name actually differs from the
// last one we reported. Fail-open when the transcript is missing/unreadable.

describe('SessionNameTracker', () => {
  let dir: string

  function makeTranscript(name: string | null, path = 'session.jsonl'): string {
    const full = join(dir, path)
    writeFileSync(
      full,
      [
        JSON.stringify({ type: 'summary', session_id: 's1', session_name: name }),
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'x' } })
      ].join('\n') + '\n',
      'utf8'
    )
    return full
  }

  it('reports the session name on first sight', () => {
    dir = mkdtempSync(join(tmpdir(), 'termsprawl-session-name-'))
    try {
      const tracker = new SessionNameTracker({ throttleMs: 0 })
      const path = makeTranscript('Socratic Gorgon')
      expect(tracker.note('sess-1', path)).toBe('Socratic Gorgon')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns null when the name is unchanged (change detection)', () => {
    dir = mkdtempSync(join(tmpdir(), 'termsprawl-session-name-'))
    try {
      const tracker = new SessionNameTracker({ throttleMs: 0 })
      const path = makeTranscript('Same Name')
      expect(tracker.note('sess-1', path)).toBe('Same Name')
      expect(tracker.note('sess-1', path)).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports a changed name after /rename updates the transcript', () => {
    dir = mkdtempSync(join(tmpdir(), 'termsprawl-session-name-'))
    try {
      const tracker = new SessionNameTracker({ throttleMs: 0 })
      const path = makeTranscript('Old Name')
      expect(tracker.note('sess-1', path)).toBe('Old Name')
      makeTranscript('New Name')
      expect(tracker.note('sess-1', path)).toBe('New Name')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('throttles reads: within throttleMs the cached name wins', () => {
    dir = mkdtempSync(join(tmpdir(), 'termsprawl-session-name-'))
    try {
      const tracker = new SessionNameTracker({ throttleMs: 60_000 })
      const path = makeTranscript('First')
      expect(tracker.note('sess-1', path)).toBe('First')
      // Rename the file underneath; the throttle must suppress the re-read.
      makeTranscript('Renamed')
      expect(tracker.note('sess-1', path)).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('stays fail-open when the transcript is unreadable', () => {
    dir = mkdtempSync(join(tmpdir(), 'termsprawl-session-name-'))
    try {
      const tracker = new SessionNameTracker({ throttleMs: 0 })
      expect(tracker.note('sess-1', join(dir, 'missing.jsonl'))).toBeNull()
      expect(tracker.note('sess-2', '')).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
