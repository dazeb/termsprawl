import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readSessionNameFromTranscript, readTranscriptTurns, formatLinkedContext } from './transcript'

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

// Task 7.5: extract printable user/assistant turns from a Claude JSONL so a
// linked peer can read another agent's conversation. Fail-open, capped.

describe('readTranscriptTurns', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'termsprawl-turns-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('extracts user string content and assistant text-array content', () => {
    const path = join(dir, 's.jsonl')
    writeFileSync(
      path,
      [
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello' } }),
        JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hi there' }] } })
      ].join('\n') + '\n',
      'utf8'
    )
    expect(readTranscriptTurns(path)).toEqual([
      { role: 'user', text: 'hello' },
      { role: 'assistant', text: 'hi there' }
    ])
  })

  it('omits tool_use, tool_result, and thinking blocks', () => {
    const path = join(dir, 's.jsonl')
    writeFileSync(
      path,
      [
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'tool_use', name: 'Bash', input: 'ls' }, { type: 'text', text: 'done' }]
          }
        }),
        JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'x' }] } })
      ].join('\n') + '\n',
      'utf8'
    )
    expect(readTranscriptTurns(path)).toEqual([{ role: 'assistant', text: 'done' }])
  })

  it('keeps only the last 40 turns', () => {
    const path = join(dir, 's.jsonl')
    const lines: string[] = []
    for (let i = 0; i < 50; i++) {
      lines.push(JSON.stringify({ type: 'user', message: { role: 'user', content: `turn-${i}` } }))
    }
    writeFileSync(path, lines.join('\n') + '\n', 'utf8')
    const turns = readTranscriptTurns(path)
    expect(turns).toHaveLength(40)
    expect(turns[0].text).toBe('turn-10')
    expect(turns[39].text).toBe('turn-49')
  })

  it('truncates a long turn to 2000 chars', () => {
    const path = join(dir, 's.jsonl')
    writeFileSync(
      path,
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'x'.repeat(3000) } }) + '\n',
      'utf8'
    )
    const turns = readTranscriptTurns(path)
    expect(turns).toHaveLength(1)
    expect(turns[0].text.length).toBe(2000)
  })

  it('fails open to [] on a missing or junk file', () => {
    expect(readTranscriptTurns(join(dir, 'nope.jsonl'))).toEqual([])
    const path = join(dir, 'bad.jsonl')
    writeFileSync(path, 'not json\n{also broken\n', 'utf8')
    expect(readTranscriptTurns(path)).toEqual([])
  })
})

describe('formatLinkedContext', () => {
  it('formats the exact CLI stdout dump', () => {
    const out = formatLinkedContext({
      peerId: 'node-2',
      peerTitle: 'Claude A',
      turns: [
        { role: 'user', text: 'refactor this' },
        { role: 'assistant', text: 'sure' }
      ]
    })
    expect(out).toBe(
      ['# linked context from Claude A (node-2)', '## user', 'refactor this', '## assistant', 'sure'].join('\n')
    )
  })
})
