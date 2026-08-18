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
      autoDownloadUpdates: true
    })
    expect(loadAppSettings(dir)).toEqual({ autoDownloadUpdates: true })
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
})
