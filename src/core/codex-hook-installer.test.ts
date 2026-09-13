// codex-hook-installer.test.ts — TOML merge/uninstall semantics.
// Codex config is TOML (not JSON like Claude's settings.json), so these tests
// exercise the line-based merge: user tables preserved, ours appended with a
// marker, uninstall removes exactly ours (by marker), double-install is a no-op.
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installCodexHooks, uninstallCodexHooks, codexConfigPath } from './codex-hook-installer'

describe('codex hook installer', () => {
  let dir: string
  let path: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'codex-hooks-'))
    path = join(dir, 'config.toml')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('creates config.toml with hook tables when none exists', () => {
    installCodexHooks(path, 'http://127.0.0.1:5555/', 'sekret')
    const raw = readFileSync(path, 'utf8')
    expect(raw).toContain('[[hooks.PreToolUse]]')
    expect(raw).toContain('[[hooks.PreToolUse.hooks]]')
    expect(raw).toContain('[[hooks.Stop]]')
    expect(raw).toContain('[[hooks.Stop.hooks]]')
    expect(raw).toContain('hook/codex?key=sekret')
    expect(raw).toContain('__termsprawl = true')
    expect(raw).toContain(`matcher = "*"`)
    expect(raw).toContain(`type = "command"`)
    // Marker on BOTH the event table and its hooks entry (uninstall keys).
    expect((raw.match(/__termsprawl = true/g) ?? []).length).toBe(22) // 11 events × 2
  })

  it('preserves existing user config tables and appends ours', () => {
    writeFileSync(
      path,
      [
        'model = "o3"',
        '',
        '[[hooks.SessionStart.hooks]]',
        'matcher = "startup|resume|clear|compact"',
        'type = "command"',
        "command = 'user-own-hook --flag'",
        'timeout = 5',
        '',
        '[hooks.state]',
        'trusted_hash = "abc"'
      ].join('\n')
    )
    installCodexHooks(path, 'http://127.0.0.1:5555/')
    const raw = readFileSync(path, 'utf8')
    // User data untouched:
    expect(raw).toContain('model = "o3"')
    expect(raw).toContain('user-own-hook --flag')
    expect(raw).toContain('[hooks.state]')
    expect(raw).toContain('trusted_hash = "abc"')
    // Exactly ONE user SessionStart table (no duplicate), and OUR entries are
    // marked — the user's own tables carry no marker.
    expect(raw.match(/\[\[hooks\.SessionStart\.hooks\]\]/g)).toHaveLength(2) // user's + ours
    expect(raw.split('user-own-hook --flag').length).toBe(2)
    expect((raw.match(/__termsprawl = true/g) ?? []).length).toBe(22) // 11 events × 2 levels
  })

  it('double-install is a no-op (marker guard)', () => {
    installCodexHooks(path, 'http://127.0.0.1:5555/')
    const once = readFileSync(path, 'utf8')
    installCodexHooks(path, 'http://127.0.0.1:5555/')
    expect(readFileSync(path, 'utf8')).toBe(once)
  })

  it('uninstall removes ONLY our tables (marker-keyed), user hooks stay', () => {
    // Mirror reality: the user's table and OUR table are separate [[...]]
    // blocks with their own headers (installCodexHooks always appends a
    // header per event). The user's PreToolUse block must survive even
    // though ours for the same event is removed.
    writeFileSync(
      path,
      [
        'model = "gpt-5"',
        '',
        '[[hooks.PreToolUse.hooks]]',
        'matcher = "*"',
        "command = 'user-own-hook'",
        '',
        '[[hooks.PreToolUse.hooks]]',
        'matcher = "*"',
        "command = 'curl http://127.0.0.1:5555/hook/codex'",
        '__termsprawl = true',
        '',
        '[[hooks.Stop.hooks]]',
        'matcher = "*"'
      ].join('\n')
    )
    uninstallCodexHooks(path)
    const raw = readFileSync(path, 'utf8')
    expect(raw).toContain('model = "gpt-5"')
    expect(raw).toContain('[[hooks.PreToolUse.hooks]]') // user table header stays
    expect(raw).toContain('user-own-hook')
    expect(raw).not.toContain('__termsprawl')
    expect(raw).not.toContain('curl http://127.0.0.1:5555')
    // User's Stop table (no marker) survives untouched.
    expect(raw).toContain('[[hooks.Stop.hooks]]')
  })

  it('uninstall is a no-op when the file lacks our marker', () => {
    writeFileSync(path, 'model = "o3"\n')
    uninstallCodexHooks(path)
    expect(readFileSync(path, 'utf8')).toBe('model = "o3"\n')
  })

  it('uninstall removes ALL our event tables across the file', () => {
    installCodexHooks(path, 'http://127.0.0.1:5555/', 'k')
    uninstallCodexHooks(path)
    const raw = readFileSync(path, 'utf8')
    expect(raw).not.toContain('hook/codex')
    expect(raw).not.toContain('__termsprawl')
    expect((raw.match(/\[\[hooks\./g) ?? []).length).toBe(0)
  })

  it('codexConfigPath points at ~/.codex/config.toml', () => {
    expect(codexConfigPath('/home/u')).toBe('/home/u/.codex/config.toml')
  })

  it('mkdirs are the caller concern: missing parent dir leaves file unwritten', () => {
    const nested = join(dir, 'nope', 'config.toml')
    installCodexHooks(nested, 'http://127.0.0.1:5555/')
    expect(existsSync(nested)).toBe(true)
  })
})

describe('codex hook installer TOML validity', () => {
  it('writes command values as valid TOML basic strings (no doubled single quotes)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'codex-hooks-toml-'))
    const path = join(dir, 'config.toml')
    try {
      installCodexHooks(path, 'http://127.0.0.1:5555/', 'sekret')
      const raw = readFileSync(path, 'utf8')
      const commandLines = raw.split('\n').filter((l) => l.startsWith('command = '))
      expect(commandLines.length).toBeGreaterThan(0)
      for (const line of commandLines) {
        // TOML basic string (double-quoted): literal single-quoted strings
        // can't contain single quotes, and the old shell-style doubling
        // (`''Content-Type''`) is a TOML parse error that kills codex.
        expect(line.startsWith('command = "')).toBe(true)
        expect(line.endsWith('"')).toBe(true)
        expect(line).not.toContain("''")
      }
      expect(raw).toContain("-H 'Content-Type: application/json'") // inner quotes survive
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('self-repairs a legacy managed block that has valid strings but missing event-level tables', () => {
    // The exact state the wild produced after 0.25.0's partial fix: correct
    // basic-string commands, but [[hooks.<Event>.hooks]] with no preceding
    // [[hooks.<Event>]] — codex rejects it ("expected a sequence in hooks").
    const dir = mkdtempSync(join(tmpdir(), 'codex-hooks-struct-'))
    const path = join(dir, 'config.toml')
    writeFileSync(
      path,
      [
        'model = "o3"',
        '',
        '[[hooks.PreToolUse.hooks]]',
        'matcher = "*"',
        'type = "command"',
        `command = "curl -s -o /dev/null -X POST -H 'Content-Type: application/json' --data-binary @- 'http://127.0.0.1:5555/hook/codex?key=s'"`,
        'timeout = 3',
        '__termsprawl = true',
        ''
      ].join('\n')
    )
    try {
      installCodexHooks(path, 'http://127.0.0.1:5555/', 'sekret')
      const raw = readFileSync(path, 'utf8')
      // Event-level tables present now (the codex-required shape).
      expect(raw).toContain('[[hooks.PreToolUse]]')
      expect(raw).toContain('__termsprawl = true\n[[hooks.') // new-structure signature
      expect((raw.match(/__termsprawl = true/g) ?? []).length).toBe(22)
      expect(raw).toContain('model = "o3"')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('leaves a CORRECT managed block untouched (double-install guard)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'codex-hooks-ok-'))
    const path = join(dir, 'config.toml')
    installCodexHooks(path, 'http://127.0.0.1:5555/', 'sekret')
    const once = readFileSync(path, 'utf8')
    installCodexHooks(path, 'http://127.0.0.1:5555/', 'sekret2') // different key: must NOT rewrite
    expect(readFileSync(path, 'utf8')).toBe(once)
    rmSync(dir, { recursive: true, force: true })
  })

  it('self-repairs a legacy broken managed block (doubled single quotes)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'codex-hooks-repair-'))
    const path = join(dir, 'config.toml')
    const legacyCommand = `command = 'curl -s -o /dev/null -X POST -H ''Content-Type: application/json'' --data-binary @- ''http://127.0.0.1:5555/hook/codex?key=s'''`
    writeFileSync(
      path,
      [
        'model = "o3"',
        '',
        '# termsprawl agent-status hooks (managed — do not edit)',
        '',
        '[[hooks.PreToolUse.hooks]]',
        'matcher = "*"',
        'type = "command"',
        legacyCommand,
        'timeout = 3',
        '__termsprawl = true',
        ''
      ].join('\n')
    )
    try {
      installCodexHooks(path, 'http://127.0.0.1:5555/', 'sekret')
      const raw = readFileSync(path, 'utf8')
      expect(raw).not.toContain("''Content-Type")
      expect((raw.match(/__termsprawl = true/g) ?? []).length).toBe(22) // 11 events × 2 levels
      const commandLines = raw.split('\n').filter((l) => l.startsWith('command = '))
      for (const line of commandLines) expect(line).not.toContain("''")
      // Structure matches codex's schema: event table + nested hooks sequence.
      expect(raw).toContain('[[hooks.PreToolUse]]')
      // User content preserved, exactly one managed block per event.
      expect(raw).toContain('model = "o3"')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('codex hook install (mkdir smoke)', () => {
  it('caller provides the dir; nested creation works via mkdirSync beforehand', () => {
    const dir = mkdtempSync(join(tmpdir(), 'codex-hooks2-'))
    const nested = join(dir, '.codex')
    mkdirSync(nested)
    const p = join(nested, 'config.toml')
    installCodexHooks(p, 'http://127.0.0.1:5555/', 's')
    uninstallCodexHooks(p)
    expect(existsSync(p)).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
})
