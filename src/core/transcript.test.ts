import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readSessionNameFromTranscript } from './transcript'

// Claude Code writes a JSONL transcript per session; summary entries carry a
// human-friendly session_name that /rename updates. Task 7.4 reads that name
// (never OSC title escapes) so node titles can mirror the agent's session.

describe('readSessionNameFromTranscript', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'termsprawl-transcript-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns the session_name from a summary line', () => {
    const path = join(dir, 'session.jsonl')
    writeFileSync(
      path,
      [
        JSON.stringify({ type: 'summary', session_id: 's1', session_name: 'Socratic Gorgon', tools_used: [] }),
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } })
      ].join('\n') + '\n',
      'utf8'
    )
    expect(readSessionNameFromTranscript(path)).toBe('Socratic Gorgon')
  })

  it('returns the latest non-null session_name across the file', () => {
    const path = join(dir, 'session.jsonl')
    writeFileSync(
      path,
      [
        JSON.stringify({ type: 'summary', session_id: 's1', session_name: 'First Name' }),
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'rename me' } }),
        JSON.stringify({ type: 'summary', session_id: 's1', session_name: 'Renamed Session' })
      ].join('\n') + '\n',
      'utf8'
    )
    expect(readSessionNameFromTranscript(path)).toBe('Renamed Session')
  })

  it('skips lines where session_name is missing or null', () => {
    const path = join(dir, 'session.jsonl')
    writeFileSync(
      path,
      [
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'x' } }),
        JSON.stringify({ type: 'summary', session_id: 's1', session_name: null }),
        JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'y' } }),
        JSON.stringify({ type: 'summary', session_id: 's1' })
      ].join('\n') + '\n',
      'utf8'
    )
    expect(readSessionNameFromTranscript(path)).toBeNull()
  })

  it('returns null when the file does not exist', () => {
    expect(readSessionNameFromTranscript(join(dir, 'nope.jsonl'))).toBeNull()
  })

  it('returns null when the file is not valid JSONL', () => {
    const path = join(dir, 'session.jsonl')
    writeFileSync(path, 'not json\n{also not\n', 'utf8')
    expect(readSessionNameFromTranscript(path)).toBeNull()
  })
})
