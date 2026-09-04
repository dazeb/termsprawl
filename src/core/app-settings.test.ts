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
      agentPreset: 'standard',
      defaultPermission: 'workspaceWrite',
      enterBehavior: 'queue',
      agentBrowserControl: false,
      agentA2aServer: false,
      invertWheelZoom: false,
      telegram: { enabled: false, allowedChatIds: [] }
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

  it('defaults onboardedAt to ABSENT (first run not yet finished)', () => {
    expect('onboardedAt' in DEFAULT_APP_SETTINGS).toBe(false)
    expect('onboardedAt' in normalizeAppSettings({})).toBe(false)
    expect('onboardedAt' in loadAppSettings(scratch())).toBe(false)
  })

  it('round-trips onboardedAt through disk', () => {
    const dir = scratch()
    const at = '2026-09-04T07:00:00.000Z'
    saveAppSettings(dir, { onboardedAt: at })
    expect(loadAppSettings(dir).onboardedAt).toBe(at)
    const raw = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) as { onboardedAt?: string }
    expect(raw.onboardedAt).toBe(at)
  })

  it('normalizes garbage onboardedAt to absent (number/object/empty string)', () => {
    for (const junk of [42, {}, '', '   ', null, []]) {
      const out = normalizeAppSettings({ onboardedAt: junk })
      expect('onboardedAt' in out).toBe(false)
    }
  })

  it('clearing onboardedAt removes the key from disk (re-run onboarding)', () => {
    const dir = scratch()
    saveAppSettings(dir, { onboardedAt: '2026-09-04T07:00:00.000Z' })
    // saveAppSettings merges; an explicit undefined patch must drop the key.
    const cleared = saveAppSettings(dir, { onboardedAt: undefined })
    expect('onboardedAt' in cleared).toBe(false)
    const raw = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) as Record<string, unknown>
    expect('onboardedAt' in raw).toBe(false)
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

  it('defaults browser home URL to unset (renderer falls back to DuckDuckGo)', () => {
    expect(DEFAULT_APP_SETTINGS.browserHomeUrl).toBeUndefined()
    expect(normalizeAppSettings({}).browserHomeUrl).toBeUndefined()
    expect(normalizeAppSettings({ browserHomeUrl: '' }).browserHomeUrl).toBeUndefined()
    expect(normalizeAppSettings({ browserHomeUrl: '   ' }).browserHomeUrl).toBeUndefined()
    expect(normalizeAppSettings({ browserHomeUrl: 42 }).browserHomeUrl).toBeUndefined()
  })

  it('keeps a set browser home URL and round-trips it through disk', () => {
    expect(normalizeAppSettings({ browserHomeUrl: 'https://search.example' }).browserHomeUrl).toBe(
      'https://search.example'
    )
    const dir = scratch()
    expect(saveAppSettings(dir, { browserHomeUrl: 'http://127.0.0.1:8888' }).browserHomeUrl).toBe(
      'http://127.0.0.1:8888'
    )
    expect(loadAppSettings(dir).browserHomeUrl).toBe('http://127.0.0.1:8888')
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

  it('telegram defaults to disabled with an empty allowlist', () => {
    expect(DEFAULT_APP_SETTINGS.telegram).toEqual({ enabled: false, allowedChatIds: [] })
    expect(normalizeAppSettings(undefined).telegram).toEqual({ enabled: false, allowedChatIds: [] })
  })

  it('normalizes a full telegram config (enabled + token + allowlist)', () => {
    const s = normalizeAppSettings({
      telegram: {
        enabled: true,
        token: '123:secret-bot-token',
        allowedChatIds: ['42', '7', 9, '', 'junk']
      }
    })
    expect(s.telegram).toEqual({
      enabled: true,
      token: '123:secret-bot-token',
      allowedChatIds: ['42', '7', 'junk']
    })
  })

  it('telegram garbage is tolerated and never leaks a partial token', () => {
    const s = normalizeAppSettings({ telegram: { enabled: 'yes', token: 7, allowedChatIds: '42' } })
    expect(s.telegram).toEqual({ enabled: false, allowedChatIds: [] })
    expect(JSON.stringify(s.telegram)).not.toContain('token')
  })

  it('telegram round-trips through disk', () => {
    const dir = scratch()
    saveAppSettings(dir, {
      telegram: { enabled: true, token: '123:roundtrip', allowedChatIds: ['42'] }
    })
    const loaded = loadAppSettings(dir)
    expect(loaded.telegram).toEqual({ enabled: true, token: '123:roundtrip', allowedChatIds: ['42'] })
  })

  it('chat settings round-trip through disk (11.4)', () => {
    const dir = scratch()
    saveAppSettings(dir, {
      chat: {
        defaultProvider: 'p1',
        defaultModel: 'gpt-4o-mini',
        keys: [{ providerId: 'p1', key: 'sk-local-only' }],
        priceOverrides: { 'gpt-4o-mini': { in: 0.15, out: 0.6 } }
      }
    })
    const loaded = loadAppSettings(dir)
    expect(loaded.chat).toEqual({
      defaultProvider: 'p1',
      defaultModel: 'gpt-4o-mini',
      keys: [{ providerId: 'p1', key: 'sk-local-only' }],
      priceOverrides: { 'gpt-4o-mini': { in: 0.15, out: 0.6 } }
    })
  })

  it('chat garbage is tolerated (11.4)', () => {
    const s = normalizeAppSettings({ chat: { defaultProvider: 7, keys: 'nope', priceOverrides: { m: 'x' } } })
    expect(s.chat).toBeUndefined()
    const s2 = normalizeAppSettings({ chat: { keys: [{ providerId: '', key: 'x' }, { providerId: 'ok', key: 5 }] } })
    expect(s2.chat).toBeUndefined()
    const s3 = normalizeAppSettings({ chat: { keys: [{ providerId: 'ok', key: 'sk-live' }] } })
    expect(s3.chat).toEqual({ keys: [{ providerId: 'ok', key: 'sk-live' }] })
  })
})
