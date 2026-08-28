// App-wide settings (not per-project). Electron-free so the Server Edition
// can share the same file.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { AppSettings, TelegramSettings } from '../shared/types'

export type { AppSettings }

export const DEFAULT_APP_SETTINGS: AppSettings = {
  autoDownloadUpdates: false,
  accounts: [],
  activeAccountId: null,
  dismissedAnnouncementVersion: null,
  a2aPeers: [],
  apiProviders: [],
  theme: 'system',
  language: 'en',
  agentPreset: 'standard',
  defaultPermission: 'workspaceWrite',
  enterBehavior: 'queue',
  // Browser nodes are usable by the user out of the box; the agent-control
  // surface (CDP facade + /open server) is opt-in, off by default.
  agentBrowserControl: false,
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

function asSafePeer(raw: unknown): { id?: string; label?: string; endpoint?: string } {
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
        .map((p) => ({ id: p.id as string, label: p.label as string, endpoint: p.endpoint as string }))
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
    language: typeof obj.language === 'string' && obj.language.length > 0 ? obj.language : 'en',
    agentPreset:
      typeof obj.agentPreset === 'string' && obj.agentPreset.length > 0 ? obj.agentPreset : 'standard',
    defaultPermission:
      typeof obj.defaultPermission === 'string' && obj.defaultPermission.length > 0
        ? obj.defaultPermission
        : 'workspaceWrite',
    enterBehavior:
      typeof obj.enterBehavior === 'string' && obj.enterBehavior.length > 0 ? obj.enterBehavior : 'queue',
    agentBrowserControl: obj.agentBrowserControl === true,
    invertWheelZoom: obj.invertWheelZoom === true,
    telegram: normalizeTelegram(obj.telegram),
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
