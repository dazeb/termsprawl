import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildClaudeHookConfig, installClaudeHooks, uninstallClaudeHooks } from './hook-installer'

// The installer writes Claude Code URL hooks that POST lifecycle events to
// our loopback hook server. It must merge (never clobber) an existing
// ~/.claude/settings.json and leave the file untouched on uninstall.

let tempDirs: string[] = []

function makeSettingsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ts-hooks-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true })
  tempDirs = []
})

describe('buildClaudeHookConfig', () => {
  it('produces URL hooks for every lifecycle event', () => {
    const hooks = buildClaudeHookConfig('http://127.0.0.1:3456/')
    expect(hooks.Stop).toHaveLength(1)
    expect(hooks.Stop[0].matcher).toBe('*')
    expect(hooks.Stop[0].hooks[0].type).toBe('url')
    expect(hooks.Stop[0].hooks[0].url).toContain('127.0.0.1:3456')
    expect(hooks.Notification).toHaveLength(1)
    expect(hooks.PreToolUse).toHaveLength(1)
    expect(hooks.PostToolUse).toHaveLength(1)
    expect(hooks.UserPromptSubmit).toHaveLength(1)
  })
})

describe('installClaudeHooks', () => {
  it('creates settings.json with hooks pointing at the server', () => {
    const dir = makeSettingsDir()
    const settingsPath = join(dir, 'settings.json')
    installClaudeHooks(settingsPath, 'http://127.0.0.1:3456/')

    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8'))
    expect(parsed.hooks.Stop[0].hooks[0].url).toContain('127.0.0.1:3456')
    // The hook server is embedded under our managed key so uninstall is safe.
    expect(parsed.__termsprawlManaged).toBe(true)
  })

  it('merges with an existing settings.json instead of clobbering it', () => {
    const dir = makeSettingsDir()
    const settingsPath = join(dir, 'settings.json')
    writeFileSync(
      settingsPath,
      JSON.stringify({ permissions: { allow: ['Bash'] }, model: 'opus' }),
      'utf8'
    )

    installClaudeHooks(settingsPath, 'http://127.0.0.1:3456/')

    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8'))
    expect(parsed.model).toBe('opus')
    expect(parsed.permissions.allow).toContain('Bash')
    expect(parsed.hooks.Stop).toHaveLength(1)
  })

  it('leaves other hooks alone when merging', () => {
    const dir = makeSettingsDir()
    const settingsPath = join(dir, 'settings.json')
    writeFileSync(
      settingsPath,
      JSON.stringify({ hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo hi' }] }] } }),
      'utf8'
    )

    installClaudeHooks(settingsPath, 'http://127.0.0.1:3456/')

    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8'))
    // The user's own PreToolUse hook survives; our events are appended.
    expect(parsed.hooks.PreToolUse).toHaveLength(2)
    expect(parsed.hooks.PreToolUse[0].hooks[0].command).toBe('echo hi')
  })
})

describe('uninstallClaudeHooks', () => {
  it('removes the managed hooks and the marker, keeping user settings', () => {
    const dir = makeSettingsDir()
    const settingsPath = join(dir, 'settings.json')
    installClaudeHooks(settingsPath, 'http://127.0.0.1:3456/')
    // user edits after install
    const after = JSON.parse(readFileSync(settingsPath, 'utf8'))
    after.model = 'sonnet'
    writeFileSync(settingsPath, JSON.stringify(after), 'utf8')

    uninstallClaudeHooks(settingsPath)

    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8'))
    expect(parsed.model).toBe('sonnet')
    expect(parsed.__termsprawlManaged).toBeUndefined()
    expect(parsed.hooks).toBeUndefined()
  })

  it('is a no-op when the file does not exist or is not managed', () => {
    const dir = makeSettingsDir()
    const settingsPath = join(dir, 'settings.json')
    expect(() => uninstallClaudeHooks(settingsPath)).not.toThrow()
    writeFileSync(settingsPath, JSON.stringify({ model: 'opus' }), 'utf8')
    expect(() => uninstallClaudeHooks(settingsPath)).not.toThrow()
  })
})
