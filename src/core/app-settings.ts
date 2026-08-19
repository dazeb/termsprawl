// App-wide settings (not per-project). Electron-free so the Server Edition
// can share the same file.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { AppSettings } from '../shared/types'

export type { AppSettings }

export const DEFAULT_APP_SETTINGS: AppSettings = {
  autoDownloadUpdates: false,
  accounts: [],
  activeAccountId: null
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
  return {
    autoDownloadUpdates: obj.autoDownloadUpdates === true,
    accounts,
    activeAccountId
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
