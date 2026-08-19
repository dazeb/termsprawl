// Context CLI logic (Phase 7, Task 7.5). parseContextArgs + runContextCli are
// tested in-process with an injected io; createRealContextIO is exercised
// against a real temp project folder.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createRealContextIO,
  parseContextArgs,
  runContextCli,
  type ContextCliIO
} from './context-cli'
import { addLink } from './context-links'
import { recordTranscriptPath } from './transcript-index'

describe('parseContextArgs', () => {
  it('parses --cwd and --self', () => {
    expect(parseContextArgs(['--cwd', '/proj', '--self', 'node-a'])).toEqual({
      cwd: '/proj',
      self: 'node-a'
    })
  })

  it('accepts argument order independence', () => {
    expect(parseContextArgs(['--self', 'node-a', '--cwd', '/proj'])).toEqual({
      cwd: '/proj',
      self: 'node-a'
    })
  })

  it('errors when a value is missing', () => {
    expect(parseContextArgs(['--cwd'])).toEqual({ error: 'missing value for --cwd' })
    expect(parseContextArgs(['--cwd', '/proj', '--self'])).toEqual({ error: 'missing value for --self' })
  })

  it('errors on unknown arguments', () => {
    expect(parseContextArgs(['--cwd', '/proj', '--self', 'node-a', '--extra'])).toEqual({
      error: 'unexpected argument: --extra'
    })
  })

  it('errors when a required flag is missing', () => {
    expect(parseContextArgs(['--cwd', '/proj'])).toEqual({ error: 'expected --cwd and --self' })
    expect(parseContextArgs([])).toEqual({ error: 'expected --cwd and --self' })
  })
})

describe('runContextCli', () => {
  function mockIo(overrides: Partial<ContextCliIO> = {}): ContextCliIO {
    const printed: string[] = []
    return {
      peers: () => [],
      transcriptPath: () => null,
      nodeTitle: () => null,
      turns: () => [],
      print: (text) => printed.push(text),
      ...overrides
    }
  }

  it('prints nothing and exits 0 when there are no peers', () => {
    const printed: string[] = []
    const io = mockIo({ print: (t) => printed.push(t) })
    expect(runContextCli({ cwd: '/p', self: 'node-a' }, io)).toBe(0)
    expect(printed).toEqual([])
  })

  it('skips peers without a known transcript', () => {
    const printed: string[] = []
    const io = mockIo({
      peers: () => ['node-b'],
      transcriptPath: () => null,
      print: (t) => printed.push(t)
    })
    expect(runContextCli({ cwd: '/p', self: 'node-a' }, io)).toBe(0)
    expect(printed).toEqual([])
  })

  it('prints the formatted dump for one peer with turns', () => {
    const printed: string[] = []
    const io = mockIo({
      peers: () => ['node-b'],
      transcriptPath: () => '/t.jsonl',
      nodeTitle: () => 'Claude B',
      turns: () => [{ role: 'user', text: 'hi' }],
      print: (t) => printed.push(t)
    })
    expect(runContextCli({ cwd: '/p', self: 'node-a' }, io)).toBe(0)
    expect(printed).toEqual(['# linked context from Claude B (node-b)\n## user\nhi'])
  })

  it('separates multiple peers with \\n---\\n and skips peers without turns', () => {
    const printed: string[] = []
    const io = mockIo({
      peers: () => ['node-b', 'node-c', 'node-d'],
      transcriptPath: (id) => `/t-${id}.jsonl`,
      turns: (path) => (path.includes('node-c') ? [] : [{ role: 'assistant', text: 'ok' }]),
      nodeTitle: () => null,
      print: (t) => printed.push(t)
    })
    runContextCli({ cwd: '/p', self: 'node-a' }, io)
    expect(printed).toEqual([
      '# linked context from node-b (node-b)\n## assistant\nok\n---\n# linked context from node-d (node-d)\n## assistant\nok'
    ])
  })

  it('falls back to the node id when there is no title', () => {
    const printed: string[] = []
    const io = mockIo({
      peers: () => ['node-b'],
      transcriptPath: () => '/b.jsonl',
      nodeTitle: () => null,
      turns: () => [{ role: 'assistant', text: 'ok' }],
      print: (t) => printed.push(t)
    })
    runContextCli({ cwd: '/p', self: 'node-a' }, io)
    expect(printed).toEqual(['# linked context from node-b (node-b)\n## assistant\nok'])
  })
})

describe('createRealContextIO end-to-end', () => {
  let cwd: string

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'termsprawl-cli-'))
    mkdirSync(join(cwd, '.termsprawl'), { recursive: true })
  })

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  it('dumps a linked peer from real link + transcript index + project file', () => {
    addLink(cwd, 'node-a', 'node-b')
    const transcript = join(cwd, 'peer-b.jsonl')
    writeFileSync(
      transcript,
      [
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'do the thing' } }),
        JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } })
      ].join('\n') + '\n',
      'utf8'
    )
    recordTranscriptPath(cwd, 'node-b', transcript)
    writeFileSync(
      join(cwd, '.termsprawl', 'project.json'),
      JSON.stringify({ version: 1, rev: 1, nodes: [{ id: 'node-b', type: 'terminal', position: { x: 0, y: 0 }, data: { title: 'Claude B' } }] }),
      'utf8'
    )

    const printed: string[] = []
    const io = createRealContextIO(cwd)
    const code = runContextCli({ cwd, self: 'node-a' }, { ...io, print: (t) => printed.push(t) })
    expect(code).toBe(0)
    expect(printed).toEqual([
      ['# linked context from Claude B (node-b)', '## user', 'do the thing', '## assistant', 'done'].join('\n')
    ])
  })

  it('prints nothing when the peer has no transcript index entry', () => {
    addLink(cwd, 'node-a', 'node-b')
    const printed: string[] = []
    const io = createRealContextIO(cwd)
    const code = runContextCli({ cwd, self: 'node-a' }, { ...io, print: (t) => printed.push(t) })
    expect(code).toBe(0)
    expect(printed).toEqual([])
  })
})