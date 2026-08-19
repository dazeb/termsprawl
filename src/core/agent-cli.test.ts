// CLI behavior probes (Phase 7, Task 7.6). TDD against a fake `claude --help`
// fixture — not a live binary.

import { describe, expect, it } from 'vitest'
import { claudeLoginArgs, claudeLoginCommand, claudeSupportsPermissionMode } from './agent-cli'

// A modern Claude `--help` advertises both the slash command and auth login.
const MODERN_HELP = `
  Usage: claude [options]

  Options:
    --permission-mode <mode>   default | acceptEdits | bypassPermissions
  Commands:
    /login                     authenticate
    auth login                 authenticate interactively
`

const OLD_HELP = `
  Usage: claude [options]
  Options:
    --model <model>
`

describe('claudeSupportsPermissionMode', () => {
  it('is true when --permission-mode appears in help', () => {
    expect(claudeSupportsPermissionMode(MODERN_HELP)).toBe(true)
  })

  it('is false for an older CLI that omits it', () => {
    expect(claudeSupportsPermissionMode(OLD_HELP)).toBe(false)
  })
})

describe('claudeLoginArgs', () => {
  it('prefers the auth login subcommand when advertised', () => {
    expect(claudeLoginArgs(MODERN_HELP)).toEqual(['auth', 'login'])
  })

  it('falls back to /login when only the slash command is advertised', () => {
    expect(claudeLoginArgs('Commands:\n  /login   authenticate')).toEqual(['/login'])
  })

  it('falls back to a bare claude when neither is advertised', () => {
    expect(claudeLoginArgs(OLD_HELP)).toEqual([])
  })
})

describe('claudeLoginCommand', () => {
  it('builds the auth login invocation for a modern CLI', () => {
    expect(claudeLoginCommand(MODERN_HELP)).toBe('claude auth login')
  })

  it('falls back to bare claude for an old CLI', () => {
    expect(claudeLoginCommand(OLD_HELP)).toBe('claude')
  })
})
