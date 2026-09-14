import { describe, expect, it } from 'vitest'
import { IPC } from './ipc'
import type { SettingsCapabilities, UsageStats } from './types'

describe('settings contracts', () => {
  it('supports empty results', () => {
    const capabilities: SettingsCapabilities = { supported: true, skills: [], hooks: [], commands: [] }
    const usage: UsageStats = { hasData: false, totalInputTokens: 0, totalOutputTokens: 0, totalCost: 0, sessions: 0, longestSessionSeconds: 0, daily: [], models: [] }
    expect(capabilities.skills).toEqual([])
    expect(usage).toMatchObject({ hasData: false, sessions: 0 })
  })
  it('preserves enum values', () => {
    const hook: SettingsCapabilities['hooks'][number] = { id: 'h', event: 'start', agent: 'codex', source: 'legacy', command: 'run-hook', enabled: false }
    const command: SettingsCapabilities['commands'][number] = { name: '/help', description: 'Help', source: 'built-in', available: true }
    expect([hook.source, command.source]).toEqual(['legacy', 'built-in'])
  })
  it('is JSON serializable and exposes no secret fields', () => {
    const value: SettingsCapabilities = { supported: true, skills: [], hooks: [], commands: [] }
    expect(JSON.parse(JSON.stringify(value))).toEqual(value)
    expect(JSON.stringify(value)).not.toMatch(/token|secret|password|api.?key/i)
    expect(IPC.settingsCapabilitiesGet).toBe('settings:capabilities-get')
    expect(IPC.settingsUsageGet).toBe('settings:usage-get')
  })
})
