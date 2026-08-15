// Agent status store — holds the latest hook-derived status per session/node
// id so terminal nodes can render RUNNING / NEEDS YOU badges. Fed by the
// preload's agent.onStatus push channel.

import { create } from 'zustand'
import type { AgentStatus } from '@shared/types'

interface AgentStatusesState {
  /** sessionId (== node id for agent nodes) → latest status. */
  byId: Record<string, AgentStatus>
  set(sessionId: string, status: AgentStatus): void
  clear(sessionId: string): void
}

export const useAgentStatuses = create<AgentStatusesState>((set) => ({
  byId: {},
  set: (sessionId, status) =>
    set((s) => ({ byId: { ...s.byId, [sessionId]: status } })),
  clear: (sessionId) =>
    set((s) => {
      const next = { ...s.byId }
      delete next[sessionId]
      return { byId: next }
    })
}))
