import { describe, expect, it } from 'vitest'
import { AGENT_REGISTRY, agentCommand, agentIds, agentName, agentTitle } from './config'

// Task 7.1 — the registry is the single source of truth for agent presets.
// Capability flags are the declared shape; Task 7.2+ normalize them against
// each CLI's real hooks/status behaviour.

describe('agent registry', () => {
  it('exposes the five agent ids', () => {
    expect(agentIds()).toEqual(['claude', 'codex', 'gemini', 'grok', 'custom'])
  })

  it('every agent has a command, name, and title', () => {
    for (const id of agentIds()) {
      const agent = AGENT_REGISTRY[id]
      expect(agent.command.length).toBeGreaterThan(0)
      expect(agent.name.length).toBeGreaterThan(0)
      expect(agent.title.length).toBeGreaterThan(0)
    }
  })

  it('every agent declares the full capability list', () => {
    const keys = [
      'hooks',
      'resume',
      'subagents',
      'recurring',
      'branch',
      'contextLink',
      'usage',
      'chat',
      'permissionMode'
    ] as const
    for (const id of agentIds()) {
      for (const key of keys) {
        expect(typeof AGENT_REGISTRY[id].capabilities[key]).toBe('boolean')
      }
    }
  })

  it('built-in CLIs are enabled by default', () => {
    expect(AGENT_REGISTRY.claude.enabled).toBe(true)
    expect(AGENT_REGISTRY.codex.enabled).toBe(true)
    expect(AGENT_REGISTRY.gemini.enabled).toBe(true)
    expect(AGENT_REGISTRY.grok.enabled).toBe(true)
    // custom is a template — not auto-enabled until configured.
    expect(AGENT_REGISTRY.custom.enabled).toBe(false)
  })

  it('helpers return the agent title/command/name', () => {
    expect(agentTitle('claude')).toBe('claude')
    expect(agentCommand('codex')).toBe('codex')
    expect(agentName('gemini')).toBe('Gemini CLI')
    expect(agentTitle('grok')).toBe('grok')
    expect(agentCommand('grok')).toBe('grok')
    expect(agentName('grok')).toBe('Grok')
  })
})
