import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findExecutable, missingCommandExec, resolveCommandLine, unresolvedNotice } from './command-resolver'

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

  it('finds agent CLIs under ~/.local/bin', () => {
    const home = mkdtempSync(join(tmpdir(), 'ts-home-'))
    tempDirs.push(home)
    const bin = join(home, '.local', 'bin')
    mkdirSync(bin, { recursive: true })
    const codex = join(bin, 'codex')
    writeFileSync(codex, '#!/bin/sh\necho codex\n', 'utf8')
    chmodSync(codex, 0o755)

    process.env.PATH = '/usr/local/bin:/usr/bin:/bin'
    expect(findExecutable('codex', home)).toBe(join(home, '.local', 'bin', 'codex'))
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

describe('gemini alias (Antigravity ships as agy on modern installs)', () => {
  it('findExecutable resolves gemini to a local agy binary', () => {
    const home = mkdtempSync(join(tmpdir(), 'ts-home-'))
    tempDirs.push(home)
    const bin = join(home, '.local', 'bin')
    mkdirSync(bin, { recursive: true })
    const agy = join(bin, 'agy')
    writeFileSync(agy, '#!/bin/sh\necho agy\n', 'utf8')
    chmodSync(agy, 0o755)
    process.env.PATH = '/usr/local/bin:/usr/bin:/bin'
    expect(findExecutable('gemini', home)).toBe(agy)
    expect(resolveCommandLine('gemini', home)).toBe(agy)
  })
})

describe('unresolvedNotice', () => {
  it('returns null when the command resolves (incl. via home fallback)', () => {
    const home = fakeHomeWithDruk()
    process.env.PATH = '/usr/local/bin:/usr/bin:/bin'
    expect(unresolvedNotice('druk', home)).toBeNull()
  })

  it('returns null when the command resolves via alias', () => {
    const home = mkdtempSync(join(tmpdir(), 'ts-home-'))
    tempDirs.push(home)
    const bin = join(home, '.local', 'bin')
    mkdirSync(bin, { recursive: true })
    const agy = join(bin, 'agy')
    writeFileSync(agy, '#!/bin/sh\necho agy\n', 'utf8')
    chmodSync(agy, 0o755)
    process.env.PATH = '/usr/local/bin:/usr/bin:/bin'
    expect(unresolvedNotice('gemini', home)).toBeNull()
  })

  it('names the command when nothing resolves', () => {
    const home = fakeHomeWithDruk()
    process.env.PATH = '/usr/local/bin:/usr/bin:/bin'
    const notice = unresolvedNotice('claude --session-id abc', home)
    expect(notice).not.toBeNull()
    expect(notice).toContain('claude')
  })

  it('returns null for an already-absolute command even if the file is absent', () => {
    expect(unresolvedNotice('/usr/bin/env foo', '/tmp/nonexistent-home')).toBeNull()
  })
})

describe('missingCommandExec', () => {
  it('produces an exec line that prints the notice and exits', () => {
    const line = missingCommandExec("termsprawl: 'claude' not found")
    expect(line.startsWith('exec /bin/sh -c ')).toBe(true)
    expect(line).toContain('exit 1')
    // The notice rides inside a double-quoted shell string (JSON-escaped);
    // single quotes are literal there, so no quote> prompts can occur.
    expect(line).toContain('claude')
    expect(line.split('\n').length).toBe(1) // one line: nothing can break the editor
  })
})
