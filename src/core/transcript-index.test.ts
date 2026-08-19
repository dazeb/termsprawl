// Transcript path index (Phase 7, Task 7.5). Persists the hook-provided
// transcript path per node so the standalone context CLI can resolve a peer's
// transcript without any event history.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readTranscriptPath, recordTranscriptPath } from './transcript-index'

describe('transcript-index', () => {
  let cwd: string

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'termsprawl-txidx-'))
  })

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  it('round-trips a recorded path', () => {
    recordTranscriptPath(cwd, 'node-a', '/home/u/.claude/projects/x/s.jsonl')
    expect(readTranscriptPath(cwd, 'node-a')).toBe('/home/u/.claude/projects/x/s.jsonl')
  })

  it('overwrites the previous path for the same node', () => {
    recordTranscriptPath(cwd, 'node-a', '/p1.jsonl')
    recordTranscriptPath(cwd, 'node-a', '/p2.jsonl')
    expect(readTranscriptPath(cwd, 'node-a')).toBe('/p2.jsonl')
  })

  it('returns null for an unknown node', () => {
    expect(readTranscriptPath(cwd, 'nope')).toBeNull()
  })

  it('ignores unsafe node ids without writing', () => {
    recordTranscriptPath(cwd, '../etc', '/p.jsonl')
    expect(readTranscriptPath(cwd, '../etc')).toBeNull()
    recordTranscriptPath(cwd, 'bad id', '/p.jsonl')
    expect(readTranscriptPath(cwd, 'bad id')).toBeNull()
  })

  it('ignores an empty path', () => {
    recordTranscriptPath(cwd, 'node-a', '')
    expect(readTranscriptPath(cwd, 'node-a')).toBeNull()
  })

  it('returns null for a junk index file', () => {
    recordTranscriptPath(cwd, 'node-a', '/p.jsonl')
    writeFileSync(join(cwd, '.termsprawl', 'transcripts', 'node-a.json'), 'not json', 'utf8')
    expect(readTranscriptPath(cwd, 'node-a')).toBeNull()
  })
})