// Agent registry (Phase 7, Task 7.1) — the single source of truth for agent
// presets. An agent node is a terminal preset that launches the CLI once
// (same command mechanism as the druk node). Capability lists are the
// declared shape; Task 7.2+ normalizes each CLI's hooks/status into the
// shared state model (working/waiting/blocked/done).

export type AgentId = 'claude' | 'codex' | 'gemini' | 'grok' | 'openclaude' | 'custom'

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
  integration: {
    strategy: 'probe'
    cliFallback: boolean
    transcriptReader: 'claude-jsonl' | null
  }
  capabilities: AgentCapabilities
}

export const AGENT_REGISTRY: Record<AgentId, AgentConfig> = {
  claude: {
    id: 'claude',
    name: 'Claude Code',
    title: 'claude',
    command: 'claude',
    enabled: true,
    integration: { strategy: 'probe', cliFallback: true, transcriptReader: 'claude-jsonl' },
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
    integration: { strategy: 'probe', cliFallback: true, transcriptReader: null },
    capabilities: {
      hooks: true,
      resume: true,
      subagents: true,
      recurring: false,
      branch: false,
      contextLink: true,
      usage: false,
      chat: false,
      permissionMode: true
    }
  },
  gemini: {
    id: 'gemini',
    // The Gemini CLI is now Antigravity. The id and command stay 'gemini' so
    // persisted canvas nodes keep their agent identity; the space image ships
    // a `gemini` shim that execs `agy`, and desktop users with the old binary
    // still work unchanged.
    name: 'Antigravity',
    title: 'antigravity',
    command: 'gemini',
    enabled: true,
    integration: { strategy: 'probe', cliFallback: true, transcriptReader: null },
    capabilities: {
      // Honesty flag: no hook normalizer exists for this CLI (hook-server
      // NORMALIZERS maps claude only), so the UI must not offer status
      // badges. Flip to true only together with a normalizer + installer.
      hooks: false,
      resume: true,
      subagents: true,
      recurring: false,
      branch: false,
      contextLink: true,
      usage: true,
      chat: false,
      permissionMode: true
    }
  },
  grok: {
    id: 'grok',
    name: 'Grok',
    title: 'grok',
    command: 'grok',
    enabled: true,
    integration: { strategy: 'probe', cliFallback: true, transcriptReader: null },
    capabilities: {
      // Honesty flag: no hook normalizer exists for this CLI (hook-server
      // NORMALIZERS maps claude only) — see the gemini note above.
      hooks: false,
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
  openclaude: {
    id: 'openclaude',
    // OpenClaude: a Claude-Code-compatible TUI that connects to any
    // OpenAI-compatible endpoint — including LOCAL models (Ollama, llama.cpp,
    // LM Studio) — so users can drive their own models on the canvas.
    name: 'OpenClaude',
    title: 'openclaude',
    command: 'openclaude',
    enabled: true,
    integration: { strategy: 'probe', cliFallback: true, transcriptReader: null },
    capabilities: {
      // Honesty: no hook normalizer exists (NORMALIZERS maps claude + codex).
      // No capability is claimed until verified against the real CLI.
      hooks: false,
      resume: false,
      subagents: false,
      recurring: false,
      branch: false,
      contextLink: true,
      usage: false,
      chat: false,
      permissionMode: false
    }
  },
  custom: {
    id: 'custom',
    name: 'Custom agent',
    title: 'agent',
    command: 'agent',
    enabled: false,
    integration: { strategy: 'probe', cliFallback: true, transcriptReader: null },
    capabilities: {
      hooks: false,
      resume: false,
      subagents: false,
      recurring: false,
      branch: false,
      contextLink: true,
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
