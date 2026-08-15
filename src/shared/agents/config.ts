// Agent registry (Phase 7, Task 7.1) — the single source of truth for agent
// presets. An agent node is a terminal preset that launches the CLI once
// (same command mechanism as the druk node). Capability lists are the
// declared shape; Task 7.2+ normalizes each CLI's hooks/status into the
// shared state model (working/waiting/blocked/done).

export type AgentId = 'claude' | 'codex' | 'gemini' | 'custom'

export interface AgentCapabilities {
  /** Hooks/status integration (7.2 hook server). */
  hooks: boolean
  /** Can resume a past conversation. */
  resume: boolean
  /** Supports subagent/task spawning. */
  subagents: boolean
  /** Supports recurring tasks. */
  recurring: boolean
  /** Can branch a conversation. */
  branch: boolean
  /** Context links between agent nodes (7.5). */
  contextLink: boolean
  /** Usage/cost reporting. */
  usage: boolean
  /** Native chat mode (non-PTY). */
  chat: boolean
  /** Permission-mode selection with CLI version gating (7.6). */
  permissionMode: boolean
}

export interface AgentConfig {
  id: AgentId
  /** Display name, e.g. "Claude Code". */
  name: string
  /** Node title default, e.g. "claude". */
  title: string
  /** CLI binary to spawn (resolved to an absolute path at spawn time). */
  command: string
  /** Visible in the canvas context menu. Custom is a template, not enabled. */
  enabled: boolean
  capabilities: AgentCapabilities
}

export const AGENT_REGISTRY: Record<AgentId, AgentConfig> = {
  claude: {
    id: 'claude',
    name: 'Claude Code',
    title: 'claude',
    command: 'claude',
    enabled: true,
    capabilities: {
      hooks: true,
      resume: true,
      subagents: true,
      recurring: true,
      branch: true,
      contextLink: true,
      usage: true,
      chat: true,
      permissionMode: true
    }
  },
  codex: {
    id: 'codex',
    name: 'Codex CLI',
    title: 'codex',
    command: 'codex',
    enabled: true,
    capabilities: {
      hooks: false,
      resume: true,
      subagents: true,
      recurring: false,
      branch: false,
      contextLink: false,
      usage: false,
      chat: false,
      permissionMode: true
    }
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini CLI',
    title: 'gemini',
    command: 'gemini',
    enabled: true,
    capabilities: {
      hooks: true,
      resume: true,
      subagents: true,
      recurring: false,
      branch: false,
      contextLink: false,
      usage: true,
      chat: false,
      permissionMode: true
    }
  },
  custom: {
    id: 'custom',
    name: 'Custom agent',
    title: 'agent',
    command: 'agent',
    enabled: false,
    capabilities: {
      hooks: false,
      resume: false,
      subagents: false,
      recurring: false,
      branch: false,
      contextLink: false,
      usage: false,
      chat: false,
      permissionMode: false
    }
  }
}

/** Registered agent ids in display order. */
export function agentIds(): AgentId[] {
  return Object.keys(AGENT_REGISTRY) as AgentId[]
}

export function agentConfig(id: AgentId): AgentConfig {
  return AGENT_REGISTRY[id]
}

export function agentName(id: AgentId): string {
  return AGENT_REGISTRY[id].name
}

export function agentTitle(id: AgentId): string {
  return AGENT_REGISTRY[id].title
}

export function agentCommand(id: AgentId): string {
  return AGENT_REGISTRY[id].command
}
