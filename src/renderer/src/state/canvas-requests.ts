// Cross-component canvas spawn requests (Phase 7, Task 7.6).
//
// The settings panel renders OUTSIDE the Canvas provider, so it cannot call
// useCanvas() to add a node. This tiny store carries a one-shot spawn request
// that Canvas consumes on its next render; Canvas stays the single source of
// truth for node state.

import { create } from 'zustand'

export type CanvasSpawnRequest =
  | { kind: 'agent'; agent: import('@shared/dependencies').InstallableAgent }
  | { kind: 'agentLogin'; command: string; title?: string }
  | { kind: 'browser'; url: string }
  | { kind: 'switchProject'; projectId: string }
  | { kind: 'organize' }
  /** Open a remote relay terminal mirroring a host terminal (B3): Canvas adds
   * a normal terminal node whose data.relayTerm = the host terminal id. */
  | { kind: 'relayTerm'; term: string; title?: string }

interface CanvasRequestsState {
  request: CanvasSpawnRequest | null
  spawn(request: CanvasSpawnRequest): void
  consume(): void
}

export const useCanvasRequests = create<CanvasRequestsState>((set) => ({
  request: null,
  spawn: (request) => set({ request }),
  consume: () => set({ request: null })
}))
