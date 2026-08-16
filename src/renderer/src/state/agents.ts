// Agent status store — holds the latest hook-derived status and an unread flag
// per session/node id so terminal nodes can render RUNNING / NEEDS YOU badges
// plus an unread dot when an agent finished while the window was unfocused.
// Fed by the preload's agent.onStatus push channel.

import { create } from 'zustand'
import { shouldNotify, type AgentStatus } from '@shared/agent-status'

interface AgentStatusesState {
  /** sessionId (== node id for agent nodes) → latest status. */
  byId: Record<string, AgentStatus>
  /** sessionId → has an unread terminal transition (busy→idle while unfocused). */
  unread: Record<string, boolean>
  /** Record a new status; marks unread on busy→idle while the window is blurred. */
  set(sessionId: string, status: AgentStatus): void
  clearUnread(sessionId: string): void
  clear(sessionId: string): void
}

export const useAgentStatuses = create<AgentStatusesState>((set, get) => ({
  byId: {},
  unread: {},
  set: (sessionId, status) => {
    const prev = get().byId[sessionId]
    const notify = shouldNotify(prev, status, {
      knownSession: true,
      windowFocused: document.hasFocus()
    })
    set((s) => ({
      byId: { ...s.byId, [sessionId]: status },
      unread: { ...s.unread, [sessionId]: notify ? true : s.unread[sessionId] ?? false }
    }))
  },
  clearUnread: (sessionId) =>
    set((s) => ({ unread: { ...s.unread, [sessionId]: false } })),
  clear: (sessionId) =>
    set((s) => {
      const byId = { ...s.byId }
      const unread = { ...s.unread }
      delete byId[sessionId]
      delete unread[sessionId]
      return { byId, unread }
    })
}))
