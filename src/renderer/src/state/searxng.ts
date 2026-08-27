// Renderer mirror of the SearXNG sidecar lifecycle (Phase 14). The heavy work
// lives in main (src/main/searxng/sidecar.ts); this store holds the latest
// status so canvas nodes (which can't take props) can resolve the browser
// home URL against it. App.tsx subscribes to the push channel once.

import { create } from 'zustand'
import type { SearxngInfo } from '@shared/types'

interface SearxngState {
  info: SearxngInfo
  setInfo: (info: SearxngInfo) => void
  /** Lazily start the sidecar (idempotent); never throws to callers. */
  ensure: () => Promise<void>
  /** Passive refresh of the current status. */
  refresh: () => Promise<void>
}

export const useSearxng = create<SearxngState>((set, get) => ({
  info: { status: 'idle' },
  setInfo: (info) => set({ info }),
  ensure: async () => {
    const current = get().info.status
    if (current === 'starting' || current === 'ready') return
    try {
      set({ info: await window.termsprawl.searxng.ensure() })
    } catch {
      /* app must work without local search */
    }
  },
  refresh: async () => {
    try {
      set({ info: await window.termsprawl.searxng.status() })
    } catch {
      /* ignore */
    }
  }
}))
