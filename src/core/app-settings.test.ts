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
    const base = {
      autoDownloadUpdates: true,
      accounts: [],
      activeAccountId: null,
      dismissedAnnouncementVersion: null,
      a2aPeers: [],
      apiProviders: [],
      theme: 'system' as const,
      language: 'en',
      agentPreset: 'standard',
      defaultPermission: 'workspaceWrite',
      enterBehavior: 'queue',
      agentBrowserControl: false,
      invertWheelZoom: false
    }
    expect(saveAppSettings(dir, { autoDownloadUpdates: true })).toEqual(base)
    expect(loadAppSettings(dir)).toEqual(base)
    const raw = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) as {
      autoDownloadUpdates: boolean
    }
    expect(raw.autoDownloadUpdates).toBe(true)
  })

  it('defaults agent browser control to OFF (manual browser works, no agent endpoint)', () => {
    expect(DEFAULT_APP_SETTINGS.agentBrowserControl).toBe(false)
    expect(normalizeAppSettings({ agentBrowserControl: 'yes' }).agentBrowserControl).toBe(false)
    expect(normalizeAppSettings({}).agentBrowserControl).toBe(false)
  })

  it('round-trips agent browser control through disk', () => {
    const dir = scratch()
    const saved = saveAppSettings(dir, { agentBrowserControl: true })
    expect(saved.agentBrowserControl).toBe(true)
    expect(loadAppSettings(dir).agentBrowserControl).toBe(true)
    const raw = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) as {
      agentBrowserControl: boolean
    }
    expect(raw.agentBrowserControl).toBe(true)
    // Toggling back off sticks.
    expect(saveAppSettings(dir, { agentBrowserControl: false }).agentBrowserControl).toBe(false)
    expect(loadAppSettings(dir).agentBrowserControl).toBe(false)
  })

  it('defaults invert-wheel-zoom to OFF and round-trips it through disk', () => {
    expect(DEFAULT_APP_SETTINGS.invertWheelZoom).toBe(false)
    expect(normalizeAppSettings({ invertWheelZoom: 'yes' }).invertWheelZoom).toBe(false)
    expect(normalizeAppSettings({}).invertWheelZoom).toBe(false)
    const dir = scratch()
    expect(saveAppSettings(dir, { invertWheelZoom: true }).invertWheelZoom).toBe(true)
    expect(loadAppSettings(dir).invertWheelZoom).toBe(true)
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

  it('defaults a2aPeers and apiProviders to empty arrays', () => {
    const s = normalizeAppSettings({})
    expect(s.a2aPeers).toEqual([])
    expect(s.apiProviders).toEqual([])
  })

  it('normalizes and keeps valid a2aPeers + apiProviders', () => {
    const s = normalizeAppSettings({
      a2aPeers: [{ id: 'p1', label: 'Peer One', endpoint: 'http://127.0.0.1:8777' }],
      apiProviders: [{ id: 'xai', name: 'xAI', baseUrl: 'https://api.x.ai/v1' }]
    })
    expect(s.a2aPeers).toEqual([{ id: 'p1', label: 'Peer One', endpoint: 'http://127.0.0.1:8777' }])
    expect(s.apiProviders).toEqual([{ id: 'xai', name: 'xAI', baseUrl: 'https://api.x.ai/v1' }])
  })

  it('drops malformed peers/providers', () => {
    const s = normalizeAppSettings({
      a2aPeers: [{ id: 'p1', label: 'Peer One' }, { id: 'p2', label: '', endpoint: 'x' }],
      apiProviders: [{ id: '', name: 'x', baseUrl: 'y' }, { id: 'ok', name: 'n', baseUrl: 'u' }]
    })
    expect(s.a2aPeers).toEqual([])
    expect(s.apiProviders).toEqual([{ id: 'ok', name: 'n', baseUrl: 'u' }])
  })

  it('save -> load round-trips the new fields', () => {
    const dir = scratch()
    saveAppSettings(dir, {
      a2aPeers: [{ id: 'p', label: 'Peer', endpoint: 'http://127.0.0.1:8787' }],
      apiProviders: [{ id: 'g', name: 'Grok', baseUrl: 'http://127.0.0.1:8080' }]
    })
    const loaded = loadAppSettings(dir)
    expect(loaded.a2aPeers).toEqual([{ id: 'p', label: 'Peer', endpoint: 'http://127.0.0.1:8787' }])
    expect(loaded.apiProviders).toEqual([{ id: 'g', name: 'Grok', baseUrl: 'http://127.0.0.1:8080' }])
  })

  it('DEFAULT_APP_SETTINGS has the new empty arrays', () => {
    expect(DEFAULT_APP_SETTINGS.a2aPeers).toEqual([])
    expect(DEFAULT_APP_SETTINGS.apiProviders).toEqual([])
  })
})
