import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_APP_SETTINGS,
  loadAppSettings,
  normalizeAppSettings,
  saveAppSettings
} from './app-settings'

describe('app-settings', () => {
  const dirs: string[] = []

  function scratch(): string {
    const dir = mkdtempSync(join(tmpdir(), 'termsprawl-settings-'))
    dirs.push(dir)
    return dir
  }

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('defaults auto-download to off', () => {
    expect(DEFAULT_APP_SETTINGS.autoDownloadUpdates).toBe(false)
    expect(normalizeAppSettings(undefined)).toEqual(DEFAULT_APP_SETTINGS)
    expect(normalizeAppSettings({ junk: true })).toEqual(DEFAULT_APP_SETTINGS)
  })

  it('returns defaults when no settings file exists', () => {
    expect(loadAppSettings(scratch())).toEqual(DEFAULT_APP_SETTINGS)
  })

  it('round-trips auto-download through disk', () => {
    const dir = scratch()
    expect(saveAppSettings(dir, { autoDownloadUpdates: true })).toEqual({
      autoDownloadUpdates: true,
      accounts: [],
      activeAccountId: null
    })
    expect(loadAppSettings(dir)).toEqual({
      autoDownloadUpdates: true,
      accounts: [],
      activeAccountId: null
    })
    const raw = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) as {
      autoDownloadUpdates: boolean
    }
    expect(raw.autoDownloadUpdates).toBe(true)
  })

  it('ignores a corrupt settings file', () => {
    const dir = scratch()
    writeFileSync(join(dir, 'settings.json'), '{not json')
    expect(loadAppSettings(dir)).toEqual(DEFAULT_APP_SETTINGS)
  })

  it('defaults accounts to [] and activeAccountId to null', () => {
    const s = normalizeAppSettings({})
    expect(s.accounts).toEqual([])
    expect(s.activeAccountId).toBeNull()
  })

  it('keeps only well-formed claude accounts and drops junk', () => {
    const s = normalizeAppSettings({
      activeAccountId: 'acc-1',
      accounts: [
        { id: 'acc-1', label: 'work', agentId: 'claude', configDir: '/ud/accounts/acc-1' },
        { id: 'acc-2', label: 'bad agent', agentId: 'codex', configDir: '/ud/x' },
        { label: 'no id' },
        'not-an-object',
        { id: 5, label: 'bad id type', agentId: 'claude', configDir: '/ud/y' }
      ]
    })
    expect(s.accounts).toEqual([
      { id: 'acc-1', label: 'work', agentId: 'claude', configDir: '/ud/accounts/acc-1' }
    ])
    expect(s.activeAccountId).toBe('acc-1')
  })

  it('coerces a non-string activeAccountId to null', () => {
    expect(normalizeAppSettings({ activeAccountId: 7 }).activeAccountId).toBeNull()
    expect(normalizeAppSettings({ activeAccountId: '' }).activeAccountId).toBeNull()
  })

  it('round-trips accounts through disk', () => {
    const dir = scratch()
    const saved = saveAppSettings(dir, {
      accounts: [{ id: 'acc-1', label: 'work', agentId: 'claude', configDir: '/ud/accounts/acc-1' }],
      activeAccountId: 'acc-1'
    })
    expect(saved.accounts).toHaveLength(1)
    expect(loadAppSettings(dir).activeAccountId).toBe('acc-1')
  })
})
