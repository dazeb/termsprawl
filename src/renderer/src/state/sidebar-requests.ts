// Cross-component sidebar section requests.
//
// The cog menu (App toolbar) renders OUTSIDE the Canvas where the sidebar
// lives, so it cannot call the sidebar directly. This tiny store carries a
// one-shot "open the source-control section" request that FileTree consumes on
// its next render (same pattern as canvas-requests).

import { create } from 'zustand'
import type { SidebarSection } from './edge-reveal'

interface SidebarRequestsState {
  request: SidebarSection | null
  openSection(section: SidebarSection): void
  consume(): void
}

export const useSidebarRequests = create<SidebarRequestsState>((set) => ({
  request: null,
  openSection: (section) => set({ request: section }),
  consume: () => set({ request: null })
}))
