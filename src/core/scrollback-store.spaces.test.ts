// Unit tests for the ScrollbackStore's space-snapshot surface (D1 import,
// D2 read-side) — pure fs, no tmux, no PTY.

import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ScrollbackStore } from './scrollback-store'

describe('ScrollbackStore snapshot import/read', () => {
  let userDataPath: string
  let store: ScrollbackStore

  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'ts-scrollback-test-'))
    store = new ScrollbackStore(userDataPath)
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
  })

  it('importSnapshot writes each entry as <nodeId>.txt and reports the count', () => {
    const imported = store.importSnapshot({
      'term-1': 'session restored\n$ ls\n',
      'term-2': 'build ok\n'
    })
    expect(imported).toBe(2)
    const dir = join(userDataPath, 'terminal-scrollback')
    expect(readdirSync(dir).sort()).toEqual(['term-1.txt', 'term-2.txt'])
    expect(store.read('term-1')).toBe('session restored\n$ ls\n')
    expect(store.read('term-2')).toBe('build ok\n')
  })

  it('importSnapshot skips non-string entries and still imports the rest', () => {
    const imported = store.importSnapshot({
      'term-1': 'good\n',
      'term-bad': 42,
      'term-2': undefined
    } as unknown as Record<string, string>)
    expect(imported).toBe(1)
    expect(store.read('term-1')).toBe('good\n')
    expect(store.read('term-bad')).toBeNull()
  })

  it('importSnapshot byte-caps oversized entries (256 KiB, keep the tail)', () => {
    const big = 'x'.repeat(300 * 1024) + 'TAIL'
    store.importSnapshot({ 'term-big': big })
    const stored = store.read('term-big') ?? ''
    expect(stored.length).toBeLessThanOrEqual(256 * 1024)
    expect(stored.endsWith('TAIL')).toBe(true)
  })

  it('readMany returns only the ids that have a stored snapshot', () => {
    store.importSnapshot({ 'term-1': 'here\n' })
    const many = store.readMany(['term-1', 'term-never-ran'])
    expect(many).toEqual({ 'term-1': 'here\n' })
  })

  it('readMany with no ids (or nothing stored) is empty, not an error', () => {
    expect(store.readMany([])).toEqual({})
    expect(store.readMany(['term-x'])).toEqual({})
  })
})
