import { describe, expect, it } from 'vitest'
import { IPC } from './ipc'
import type { SettingsCapabilities, UsageStats } from './types'

describe('settings contracts', () => {
  it('supports empty results', () => {
    const capabilities: SettingsCapabilities = { supported: true, skills: [], hooks: [], commands: [], mcp: [], plugins: [], subagents: [] }
    const usage: UsageStats = { supported: true, hasData: false, totalInputTokens: 0, totalOutputTokens: 0, totalCost: 0, sessions: 0, longestSessionSeconds: 0, daily: [], models: [] }
    expect(capabilities.skills).toEqual([])
    expect(usage).toMatchObject({ hasData: false, sessions: 0 })
  })
  it('preserves enum values', () => {
    const hook: SettingsCapabilities['hooks'][number] = { id: 'h', event: 'start', agent: 'codex', source: 'legacy', command: 'run-hook', enabled: false }
    const command: SettingsCapabilities['commands'][number] = { name: '/help', description: 'Help', source: 'built-in', available: true }
    expect([hook.source, command.source]).toEqual(['legacy', 'built-in'])
  })
  it('is JSON serializable and exposes no secret fields', () => {
    const value: SettingsCapabilities = { supported: true, skills: [], hooks: [], commands: [], mcp: [], plugins: [], subagents: [] }
    expect(JSON.parse(JSON.stringify(value))).toEqual(value)
    expect(JSON.stringify(value)).not.toMatch(/token|secret|password|api.?key/i)
    expect(IPC.settingsCapabilitiesGet).toBe('settings:capabilities-get')
    expect(IPC.settingsUsageGet).toBe('settings:usage-get')
    expect(IPC.settingsSetSkillEnabled).toBe('settings:set-skill-enabled')
    expect(IPC.settingsSetPluginEnabled).toBe('settings:set-plugin-enabled')
    expect(IPC.settingsReinstallHooks).toBe('settings:reinstall-hooks')
  })

  it('describes a skill and an MCP server without carrying secrets', () => {
    const skill: SettingsCapabilities['skills'][number] = {
      id: 'codex:pdf',
      name: 'pdf',
      description: 'Read, create and verify PDFs',
      source: 'codex',
      agent: 'codex',
      path: 'pdf',
      enabled: false
    }
    const server: SettingsCapabilities['mcp'][number] = {
      id: 'codex:node_repl',
      name: 'node_repl',
      agent: 'codex',
      transport: 'stdio',
      detail: 'npx -y node-repl',
      configPath: '/home/u/.codex/config.toml'
    }
    expect([skill.enabled, server.transport]).toEqual([false, 'stdio'])
  })
})
