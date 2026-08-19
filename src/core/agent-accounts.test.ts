// Managed agent accounts (Phase 7, Task 7.6). TDD: dir lifecycle, safe ids,
// CLAUDE_CONFIG_DIR env, and the auth-env strip list.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppSettings } from '../shared/types'
import {
  AUTH_ENV,
  accountConfigDir,
  activeAccount,
  claudeConfigEnv,
  createManagedAccount,
  deleteManagedAccount,
  newAccountId,
  stripAuthEnv
} from './agent-accounts'

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

describe('account dirs', () => {
  it('nests a config dir under userData/accounts/<id>', () => {
    expect(accountConfigDir('/ud', 'acc-1')).toBe(join('/ud', 'accounts', 'acc-1'))
  })

  it('generates a collision-resistant safe id', () => {
    expect(SAFE_ID.test(newAccountId())).toBe(true)
  })

  it('creates a managed dir and returns a safe record (never stores tokens)', () => {
    const userData = join(tmpdir(), `ud-${Date.now()}`)
    try {
      const acc = createManagedAccount(userData, 'work')
      expect(SAFE_ID.test(acc.id)).toBe(true)
      expect(acc.label).toBe('work')
      expect(acc.configDir).toBe(accountConfigDir(userData, acc.id))
      expect(existsSync(acc.configDir)).toBe(true)
    } finally {
      rmSync(userData, { recursive: true, force: true })
    }
  })
})

describe('deleteManagedAccount', () => {
  let userData: string

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'ud-del-'))
  })

  afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
  })

  it('removes the managed config dir', () => {
    const acc = createManagedAccount(userData, 'x')
    writeFileSync(join(acc.configDir, 'credentials.json'), '{}', 'utf8')
    deleteManagedAccount(userData, acc.id)
    expect(existsSync(acc.configDir)).toBe(false)
  })

  it('is a no-op for a missing dir', () => {
    expect(() => deleteManagedAccount(userData, 'nope')).not.toThrow()
  })
})

describe('claudeConfigEnv', () => {
  it('points CLAUDE_CONFIG_DIR at the managed dir', () => {
    expect(claudeConfigEnv('/ud/accounts/acc-1')).toEqual({
      CLAUDE_CONFIG_DIR: '/ud/accounts/acc-1'
    })
  })
})

describe('stripAuthEnv', () => {
  it('drops exactly the auth keys from a copy and keeps other vars', () => {
    const input: Record<string, string | undefined> = {
      ANTHROPIC_API_KEY: 'sekret',
      CLAUDE_API_KEY: 'sekret2',
      ANTHROPIC_AUTH_TOKEN: 'sekret3',
      PATH: '/usr/bin',
      TERM: 'xterm'
    }
    const out = stripAuthEnv(input)
    expect(out.ANTHROPIC_API_KEY).toBeUndefined()
    expect(out.CLAUDE_API_KEY).toBeUndefined()
    expect(out.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(out.PATH).toBe('/usr/bin')
    expect(out.TERM).toBe('xterm')
    // the caller's env object is not mutated
    expect(input.ANTHROPIC_API_KEY).toBe('sekret')
  })

  it('matches the documented strip list', () => {
    expect(AUTH_ENV).toEqual(['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY', 'ANTHROPIC_AUTH_TOKEN'])
  })
})

describe('activeAccount', () => {
  const settings: AppSettings = {
    autoDownloadUpdates: false,
    accounts: [{ id: 'acc-1', label: 'work', agentId: 'claude', configDir: '/ud/accounts/acc-1' }],
    activeAccountId: 'acc-1'
  }

  it('resolves the active account by id', () => {
    expect(activeAccount(settings)?.label).toBe('work')
  })

  it('returns undefined when no account is active', () => {
    expect(activeAccount({ ...settings, activeAccountId: null })).toBeUndefined()
  })

  it('returns undefined for an unknown id (fall back to default ~/.claude)', () => {
    expect(activeAccount({ ...settings, activeAccountId: 'acc-missing' })).toBeUndefined()
  })
})
