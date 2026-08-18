// App-wide settings (not per-project). Electron-free so the Server Edition
// can share the same file.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { AppSettings } from '../shared/types'

export type { AppSettings }

export const DEFAULT_APP_SETTINGS: AppSettings = {
  autoDownloadUpdates: false
}

const SETTINGS_FILE = 'settings.json'

export function settingsPath(userDataPath: string): string {
  return join(userDataPath, SETTINGS_FILE)
}

export function normalizeAppSettings(raw: unknown): AppSettings {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    autoDownloadUpdates: obj.autoDownloadUpdates === true
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
