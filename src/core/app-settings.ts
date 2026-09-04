// App-wide settings (not per-project). Electron-free so the Server Edition
// can share the same file.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { AppSettings, ChatSettings, ProviderKey, TelegramSettings } from '../shared/types'

export type { AppSettings }

export const DEFAULT_APP_SETTINGS: AppSettings = {
  autoDownloadUpdates: false,
  accounts: [],
  activeAccountId: null,
  dismissedAnnouncementVersion: null,
  a2aPeers: [],
  apiProviders: [],
  theme: 'system',
  agentPreset: 'standard',
  defaultPermission: 'workspaceWrite',
  enterBehavior: 'queue',
  // Browser nodes are usable by the user out of the box; the agent-control
  // surface (CDP facade + /open server) is opt-in, off by default.
  agentBrowserControl: false,
  // The A2A server (expose agent nodes to peers) is opt-in, off by default.
  agentA2aServer: false,
  // Mousewheel zooms the canvas; scroll-up = zoom in by default.
  invertWheelZoom: false,
  // Telegram bot is opt-in, off by default (token required to start).
  telegram: { enabled: false, allowedChatIds: [] }
}

const SETTINGS_FILE = 'settings.json'

export function settingsPath(userDataPath: string): string {
  return join(userDataPath, SETTINGS_FILE)
}

function asSafeAccount(raw: unknown): { id?: string; label?: string; agentId?: string; configDir?: string; permissionMode?: unknown } {
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
}

function isPermissionMode(v: unknown): v is 'default' | 'acceptEdits' | 'bypassPermissions' {
  return v === 'default' || v === 'acceptEdits' || v === 'bypassPermissions'
}

function asSafePeer(raw: unknown): { id?: string; label?: string; endpoint?: string; token?: string } {
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
}

function asSafeProvider(raw: unknown): { id?: string; name?: string; baseUrl?: string } {
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
}

/** Telegram settings normalization: booleans coerced, token kept only as a
 * non-empty string, allowed chat ids filtered to strings. Garbage tolerated.
 * Always returns the full default shape so a fresh file equals the defaults. */
function normalizeTelegram(raw: unknown): TelegramSettings {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const out: TelegramSettings = { enabled: false, allowedChatIds: [] }
  if (obj.enabled === true) out.enabled = true
  if (typeof obj.token === 'string' && obj.token.length > 0) out.token = obj.token
  if (Array.isArray(obj.allowedChatIds)) {
    out.allowedChatIds = obj.allowedChatIds.filter(
      (id): id is string => typeof id === 'string' && id.length > 0
    )
  }
  return out
}

/** Chat driver v2 settings (11.4): default provider/model + locally-stored
 * provider keys + optional price overrides. Keys live on this machine only.
 * Returns undefined when nothing is configured (keeps the default-settings
 * shape stable for existing tests/consumers). */
function normalizeChat(raw: unknown): ChatSettings | undefined {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const out: ChatSettings = {}
  if (typeof obj.defaultProvider === 'string' && obj.defaultProvider.length > 0) {
    out.defaultProvider = obj.defaultProvider
  }
  if (typeof obj.defaultModel === 'string' && obj.defaultModel.length > 0) {
    out.defaultModel = obj.defaultModel
  }
  if (Array.isArray(obj.keys)) {
    out.keys = obj.keys
      .filter(
        (k): k is ProviderKey =>
          k !== null && typeof k === 'object' &&
          typeof (k as ProviderKey).providerId === 'string' &&
          (k as ProviderKey).providerId.length > 0 &&
          typeof (k as ProviderKey).key === 'string'
      )
      .map((k) => ({ providerId: k.providerId, key: k.key }))
    if (out.keys && out.keys.length === 0) delete out.keys
  }
  if (obj.priceOverrides && typeof obj.priceOverrides === 'object') {
    const overrides: Record<string, { in: number; out: number }> = {}
    for (const [model, price] of Object.entries(obj.priceOverrides as Record<string, unknown>)) {
      if (
        price && typeof price === 'object' &&
        typeof (price as { in?: unknown }).in === 'number' &&
        typeof (price as { out?: unknown }).out === 'number'
      ) {
        overrides[model] = { in: (price as { in: number }).in, out: (price as { out: number }).out }
      }
    }
    // only carry overrides when at least one parsed
    if (Object.keys(overrides).length > 0) out.priceOverrides = overrides
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** Relay service settings (11.2): the URL to dial + role + pairing invite and
 * confirmed fingerprint. The Settings→Relay UI persists these via
 * saveAppSettings, and resolveTarget() dials appSettings.current.relay, so
 * normalize MUST carry the key through or every save/load silently drops it.
 * Returns undefined when no relay is configured (url absent/invalid), keeping
 * a settings.json without relay clean. */
function normalizeRelay(raw: unknown): AppSettings['relay'] | undefined {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const out: NonNullable<AppSettings['relay']> = {}
  if (typeof obj.url === 'string' && obj.url.trim().length > 0) out.url = obj.url.trim()
  // No valid url → nothing to dial; treat the relay as unconfigured.
  if (!out.url) return undefined
  out.role = obj.role === 'host' || obj.role === 'client' ? obj.role : 'host'
  if (typeof obj.invite === 'string' && obj.invite.length > 0) out.invite = obj.invite
  if (typeof obj.trustedFingerprint === 'string' && obj.trustedFingerprint.length > 0) {
    out.trustedFingerprint = obj.trustedFingerprint
  }
  return out
}

export function normalizeAppSettings(raw: unknown): AppSettings {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const accounts = Array.isArray(obj.accounts)
    ? obj.accounts
        .map(asSafeAccount)
        .filter(
          (a) =>
            typeof a.id === 'string' &&
            a.id.length > 0 &&
            typeof a.label === 'string' &&
            a.agentId === 'claude' &&
            typeof a.configDir === 'string'
        )
        .map((a) => ({
          id: a.id as string,
          label: a.label as string,
          agentId: 'claude' as const,
          configDir: a.configDir as string,
          ...(isPermissionMode(a.permissionMode) ? { permissionMode: a.permissionMode } : {})
        }))
    : []
  const activeAccountId =
    typeof obj.activeAccountId === 'string' && obj.activeAccountId.length > 0
      ? obj.activeAccountId
      : null
  const a2aPeers = Array.isArray(obj.a2aPeers)
    ? obj.a2aPeers
        .map(asSafePeer)
        .filter(
          (p) =>
            typeof p.id === 'string' &&
            p.id.length > 0 &&
            typeof p.label === 'string' &&
            p.label.length > 0 &&
            typeof p.endpoint === 'string' &&
            p.endpoint.length > 0
        )
        .map((p) => ({
          id: p.id as string,
          label: p.label as string,
          endpoint: p.endpoint as string,
          ...(typeof p.token === 'string' && p.token.length > 0 ? { token: p.token } : {})
        }))
    : []
  const apiProviders = Array.isArray(obj.apiProviders)
    ? obj.apiProviders
        .map(asSafeProvider)
        .filter(
          (p) =>
            typeof p.id === 'string' &&
            p.id.length > 0 &&
            typeof p.name === 'string' &&
            p.name.length > 0 &&
            typeof p.baseUrl === 'string' &&
            p.baseUrl.length > 0
        )
        .map((p) => ({ id: p.id as string, name: p.name as string, baseUrl: p.baseUrl as string }))
    : []
  return {
    autoDownloadUpdates: obj.autoDownloadUpdates === true,
    accounts,
    activeAccountId,
    dismissedAnnouncementVersion:
      typeof obj.dismissedAnnouncementVersion === 'string'
        ? obj.dismissedAnnouncementVersion
        : null,
    ...(typeof obj.displayName === 'string' && obj.displayName.length > 0 ? { displayName: obj.displayName } : {}),
    a2aPeers,
    apiProviders,
    theme: obj.theme === 'light' || obj.theme === 'dark' || obj.theme === 'system' ? obj.theme : 'system',
    agentPreset:
      typeof obj.agentPreset === 'string' && obj.agentPreset.length > 0 ? obj.agentPreset : 'standard',
    defaultPermission:
      typeof obj.defaultPermission === 'string' && obj.defaultPermission.length > 0
        ? obj.defaultPermission
        : 'workspaceWrite',
    enterBehavior:
      typeof obj.enterBehavior === 'string' && obj.enterBehavior.length > 0 ? obj.enterBehavior : 'queue',
    agentBrowserControl: obj.agentBrowserControl === true,
    agentA2aServer: obj.agentA2aServer === true,
    invertWheelZoom: obj.invertWheelZoom === true,
    // First-run marker: only a non-empty trimmed string counts; anything else
    // (absent, junk, whitespace) keeps the key absent so onboarding can show.
    ...(typeof obj.onboardedAt === 'string' && obj.onboardedAt.trim().length > 0
      ? { onboardedAt: obj.onboardedAt.trim() }
      : {}),
    telegram: normalizeTelegram(obj.telegram),
    ...(normalizeChat(obj.chat) ? { chat: normalizeChat(obj.chat) } : {}),
    ...(normalizeRelay(obj.relay) ? { relay: normalizeRelay(obj.relay) } : {}),
    ...(typeof obj.browserHomeUrl === 'string' && obj.browserHomeUrl.trim().length > 0
      ? { browserHomeUrl: obj.browserHomeUrl.trim() }
      : {})
  }
}

export function loadAppSettings(userDataPath: string): AppSettings {
  const path = settingsPath(userDataPath)
  if (!existsSync(path)) return { ...DEFAULT_APP_SETTINGS }
  try {
    return normalizeAppSettings(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return { ...DEFAULT_APP_SETTINGS }
  }
}

export function saveAppSettings(userDataPath: string, patch: Partial<AppSettings>): AppSettings {
  const next = normalizeAppSettings({ ...loadAppSettings(userDataPath), ...patch })
  mkdirSync(userDataPath, { recursive: true })
  writeFileSync(settingsPath(userDataPath), `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return next
}
