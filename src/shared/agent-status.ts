// Agent status model + notification decision — the shared contract between
// main (hook server), preload, and renderer. Pure, no electron, no fs.

export type AgentStatus = 'working' | 'waiting' | 'blocked' | 'done'
export type AgentSessionKind = 'session' | 'subagent' | 'recurring'

export interface AgentStatusEvent {
  sessionId: string
  status: AgentStatus
  kind: AgentSessionKind
  tool?: string
  ts: number
}

const TERMINAL_STATUSES: AgentStatus[] = ['waiting', 'blocked', 'done']

/**
 * Decide whether a status change warrants an OS notification + unread dot.
 * Notify only when: the session belongs to a live termsprawl node, the window
 * is not focused, and the status transitions into a terminal state
 * (done/waiting/blocked) that is different from the previous one. A first
 * event that is already terminal also notifies.
 */
export function shouldNotify(
  prev: AgentStatus | undefined,
  next: AgentStatus,
  opts: { knownSession: boolean; windowFocused: boolean }
): boolean {
  if (!opts.knownSession || opts.windowFocused) return false
  if (!TERMINAL_STATUSES.includes(next)) return false
  return prev !== next
}
