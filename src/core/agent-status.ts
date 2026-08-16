// Agent hook normalization — maps each agent CLI's hook payloads into the
// shared status model. Electron-free; the hook server (main) and future
// Server Edition both use it.
//
// Status model: working / waiting / blocked / done
// Kinds: session / subagent / recurring

import type { AgentSessionKind, AgentStatus, AgentStatusEvent } from '../shared/agent-status'

export type { AgentSessionKind, AgentStatus, AgentStatusEvent } from '../shared/agent-status'

interface RawHookPayload {
  hook_event_name?: unknown
  session_id?: unknown
  subagent_id?: unknown
  tool_name?: unknown
  [key: string]: unknown
}

/** Claude Code URL-hook payload → AgentStatusEvent, or null when unrecognized. */
export function normalizeClaudeHook(body: unknown): AgentStatusEvent | null {
  if (!body || typeof body !== 'object') return null
  const raw = body as RawHookPayload
  if (typeof raw.hook_event_name !== 'string' || typeof raw.session_id !== 'string') {
    return null
  }

  let status: AgentStatus | null = null
  let kind: AgentSessionKind = 'session'

  switch (raw.hook_event_name) {
    case 'PreToolUse':
    case 'PostToolUse':
    case 'PostToolUseFailure':
    case 'UserPromptSubmit':
    case 'PreCompact':
      status = 'working'
      break
    case 'Notification':
      status = 'waiting'
      break
    case 'PermissionRequest':
      status = 'blocked'
      break
    case 'Stop':
    case 'SubagentStop':
      status = 'done'
      if (raw.hook_event_name === 'SubagentStop' || raw.subagent_id) kind = 'subagent'
      break
    default:
      return null
  }

  return {
    sessionId: raw.session_id,
    status,
    kind,
    tool: typeof raw.tool_name === 'string' ? raw.tool_name : undefined,
    ts: Date.now()
  }
}
