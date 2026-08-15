import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findExecutable, resolveCommandLine } from './command-resolver'

// The resolver exists because GUI-launched apps (AppImage from a desktop
// launcher) inherit a minimal PATH that omits user dirs like ~/.druk/bin —
// while `shell -lc` does NOT source .zshrc, so druk would be "not found".
// We resolve the command to an absolute path before spawning.

let tempDirs: string[] = []
const originalPath = process.env.PATH

function fakeHomeWithDruk(): string {
  const home = mkdtempSync(join(tmpdir(), 'ts-home-'))
  tempDirs.push(home)
  const bin = join(home, '.druk', 'bin')
  mkdirSync(bin, { recursive: true })
  const druk = join(bin, 'druk')
  writeFileSync(druk, '#!/bin/sh\necho fake druk\n', 'utf8')
  chmodSync(druk, 0o755)
  return home
}

afterEach(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true })
  tempDirs = []
  process.env.PATH = originalPath
})

describe('findExecutable', () => {
  it('finds druk under the home fallback when PATH is minimal', () => {
    const home = fakeHomeWithDruk()
    // Simulate a GUI-launched app: minimal PATH with no user dirs.
    process.env.PATH = '/usr/local/bin:/usr/bin:/bin'
    const resolved = findExecutable('druk', home)
    expect(resolved).toBe(join(home, '.druk', 'bin', 'druk'))
  })

  it('returns null when the command exists nowhere', () => {
    const home = fakeHomeWithDruk()
    process.env.PATH = '/usr/local/bin:/usr/bin:/bin'
    expect(findExecutable('definitely-not-a-real-cmd-xyz', home)).toBeNull()
  })
})

describe('resolveCommandLine', () => {
  it('resolves a bare command to an absolute path via the home fallback', () => {
    const home = fakeHomeWithDruk()
    process.env.PATH = '/usr/local/bin:/usr/bin:/bin'
    const resolved = resolveCommandLine('druk', home)
    expect(resolved).toBe(join(home, '.druk', 'bin', 'druk'))
  })

  it('leaves an already-absolute command untouched', () => {
    expect(resolveCommandLine('/usr/bin/env foo', '/tmp/nonexistent-home')).toBe(
      '/usr/bin/env foo'
    )
  })

  it('returns the original line when nothing resolves', () => {
    expect(resolveCommandLine('missing-cmd --flag', '/tmp/nonexistent-home')).toBe(
      'missing-cmd --flag'
    )
  })
})
