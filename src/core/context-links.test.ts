// Context link files (Phase 7, Task 7.5). Links are files on disk —
// <cwd>/.termsprawl/links/<idA>--<idB>.json — so a host CLI can resolve peers
// without going through Electron. Pure fs helpers; never throw.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addLink, linkFilePath, listLinks, parseLinkFile, peersOf, removeLink } from './context-links'

describe('context-links', () => {
  let cwd: string

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'termsprawl-links-'))
  })

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  it('linkFilePath sorts ids so (b,a) == (a,b)', () => {
    expect(linkFilePath(cwd, 'node-b', 'node-a')).toBe(linkFilePath(cwd, 'node-a', 'node-b'))
  })

  it('linkFilePath uses the canonical pair in the file name', () => {
    const path = linkFilePath(cwd, 'node-b', 'node-a')
    expect(path).toContain('.termsprawl')
    expect(path).toContain('node-a--node-b.json')
  })

  it('addLink then listLinks returns one pair', () => {
    addLink(cwd, 'aaa', 'bbb')
    expect(listLinks(cwd)).toEqual([{ a: 'aaa', b: 'bbb', path: linkFilePath(cwd, 'aaa', 'bbb') }])
  })

  it('a second addLink is idempotent', () => {
    addLink(cwd, 'aaa', 'bbb')
    addLink(cwd, 'aaa', 'bbb')
    expect(listLinks(cwd)).toHaveLength(1)
  })

  it('removeLink deletes the file; a missing file does not throw', () => {
    addLink(cwd, 'aaa', 'bbb')
    removeLink(cwd, 'aaa', 'bbb')
    expect(listLinks(cwd)).toHaveLength(0)
    expect(() => removeLink(cwd, 'aaa', 'bbb')).not.toThrow()
  })

  it('peersOf returns the other id for either endpoint', () => {
    addLink(cwd, 'aaa', 'bbb')
    addLink(cwd, 'aaa', 'ccc')
    expect(peersOf(cwd, 'aaa').sort()).toEqual(['bbb', 'ccc'])
    expect(peersOf(cwd, 'bbb')).toEqual(['aaa'])
    expect(peersOf(cwd, 'zzz')).toEqual([])
  })

  it('rejects a self link with an error object, never throws', () => {
    expect(addLink(cwd, 'aaa', 'aaa')).toEqual({ error: { code: 'SELF', message: expect.any(String) } })
    expect(listLinks(cwd)).toHaveLength(0)
  })

  it('rejects unsafe ids', () => {
    expect(addLink(cwd, '../etc', 'bbb')).toEqual({ error: { code: 'BAD_ID', message: expect.any(String) } })
    expect(addLink(cwd, 'aaa b', 'bbb')).toEqual({ error: { code: 'BAD_ID', message: expect.any(String) } })
    expect(listLinks(cwd)).toHaveLength(0)
  })

  it('parseLinkFile accepts a valid file', () => {
    expect(parseLinkFile('{"version":1,"a":"node-a","b":"node-b"}')).toEqual({ a: 'node-a', b: 'node-b' })
  })

  it('parseLinkFile returns null for junk and wrong shapes', () => {
    expect(parseLinkFile('not json')).toBeNull()
    expect(parseLinkFile('{"version":1,"a":"node-a"}')).toBeNull()
    expect(parseLinkFile('{"version":2,"a":"node-a","b":"node-b"}')).toBeNull()
    expect(parseLinkFile('{"version":1,"a":"node-a","b":"node-a"}')).toBeNull()
    expect(parseLinkFile('{"version":1,"a":"../etc","b":"node-b"}')).toBeNull()
  })
})