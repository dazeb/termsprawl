// The configured browser home page (14.1). Lives in a module-level store so
// React Flow custom nodes (which only receive NodeProps) can read the current
// setting without prop drilling through the canvas. App.tsx syncs it whenever
// app settings change; BrowserNode + Canvas read it at node/tab creation.

import { create } from 'zustand'

interface BrowserHomeState {
  /** User-configured home URL, or undefined for the app default. */
  homeUrl: string | undefined
  setHomeUrl: (url: string | undefined) => void
}

export const useBrowserHome = create<BrowserHomeState>((set) => ({
  homeUrl: undefined,
  setHomeUrl: (homeUrl) => set({ homeUrl })
}))
