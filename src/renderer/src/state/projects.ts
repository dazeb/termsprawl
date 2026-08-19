// Projects store — project metadata + serialized nodes, backed by the
// workspace IPC. React Flow remains the single live source of truth for the
// ACTIVE project's nodes; this store holds the list and the disk contract.

import { create } from 'zustand'
import type { DurableCleanupResult, ProjectMeta, ProjectSettings, SerializedNode } from '@shared/types'

interface ProjectsState {
  projects: ProjectMeta[]
  activeProjectId: string | null
  /** Per-project serialized nodes, loaded from disk. */
  nodeCache: Record<string, SerializedNode[]>
  /** Current-process invalidations that late async saves must not re-cache. */
  tombstonedNodeIds: Record<string, string[]>
  loaded: boolean

  load(): Promise<void>
  select(id: string): void
  /** Create a project (folder or inline); returns its meta. */
  create(name: string, cwd: string | null): Promise<ProjectMeta>
  /** Persist the active project's nodes. */
  saveNodes(nodes: SerializedNode[]): Promise<void>
  /** Persist nodes for an explicit project, even after the active tab changes. */
  saveProjectNodes(id: string, nodes: SerializedNode[]): Promise<void>
  dropCachedNode(projectId: string, nodeId: string): void
  /** Close any project by id (detach, keep sessions); updates local state. */
  close(id: string): Promise<void>
  /** Archive any project by id (close + hide); updates local state. */
  archive(id: string): Promise<void>
  reopen(id: string): Promise<void>
  delete(id: string): Promise<DurableCleanupResult>
  /** Merge per-project settings (accent, etc.). */
  updateSettings(id: string, patch: ProjectSettings): Promise<void>
  rename(id: string, name: string): Promise<void>
}

export const useProjects = create<ProjectsState>((set, get) => ({
  projects: [],
  activeProjectId: null,
  nodeCache: {},
  tombstonedNodeIds: {},
  loaded: false,

  async load() {
    const snap = await window.termsprawl.workspace.snapshot()
    const open = snap.index.projects.filter((p) => !p.closed)
    const tombstonedNodeIds = (snap.index.terminalTombstones ?? []).reduce<Record<string, string[]>>(
      (byProject, entry) => ({
        ...byProject,
        [entry.projectId]: [...(byProject[entry.projectId] ?? []), entry.terminalId]
      }),
      {}
    )
    const nodeCache = Object.fromEntries(
      await Promise.all(
        Object.entries(snap.projects).map(async ([projectId, nodes]) => {
          const tombstones = new Set(tombstonedNodeIds[projectId] ?? [])
          const kept = nodes.filter((node) => !tombstones.has(node.id))
          const project = snap.index.projects.find((p) => p.id === projectId)
          if (!project?.cwd) return [projectId, kept]
          // Source of truth for context links is the files on disk; rebuild the
          // cache so a git-pulled `.termsprawl/links/` shows up on load.
          const res = await window.termsprawl.contextLinks.list(project.cwd)
          if (!res.ok || res.links.length === 0) return [projectId, kept]
          return [
            projectId,
            kept.map((node) => {
              if (node.type !== 'terminal') return node
              const linkedIds = res.links
                .filter((l) => l.a === node.id || l.b === node.id)
                .map((l) => (l.a === node.id ? l.b : l.a))
              if (linkedIds.length === 0) return node
              return { ...node, data: { ...node.data, linkedIds } }
            })
          ]
        })
      )
    )
    set({
      projects: snap.index.projects,
      nodeCache,
      tombstonedNodeIds,
      activeProjectId: open[0]?.id ?? null,
      loaded: true
    })
  },

  select(id: string) {
    set({ activeProjectId: id })
  },

  async create(name: string, cwd: string | null) {
    const project = await window.termsprawl.workspace.addProject(name, cwd)
    set((s) => ({
      projects: [...s.projects.filter((p) => p.id !== project.id), project],
      nodeCache: { ...s.nodeCache, [project.id]: [] },
      tombstonedNodeIds: { ...s.tombstonedNodeIds, [project.id]: [] },
      activeProjectId: project.id
    }))
    return project
  },

  async saveNodes(nodes: SerializedNode[]) {
    const id = get().activeProjectId
    if (!id) return
    await get().saveProjectNodes(id, nodes)
  },

  async saveProjectNodes(id: string, nodes: SerializedNode[]) {
    const beforeSave = new Set(get().tombstonedNodeIds[id] ?? [])
    await window.termsprawl.workspace.saveNodes(
      id,
      nodes.filter((node) => !beforeSave.has(node.id))
    )
    set((s) => {
      const tombstones = new Set(s.tombstonedNodeIds[id] ?? [])
      return {
        nodeCache: {
          ...s.nodeCache,
          [id]: nodes.filter((node) => !tombstones.has(node.id))
        }
      }
    })
  },

  dropCachedNode(projectId: string, nodeId: string) {
    set((s) => ({
      tombstonedNodeIds: {
        ...s.tombstonedNodeIds,
        [projectId]: [...new Set([...(s.tombstonedNodeIds[projectId] ?? []), nodeId])]
      },
      nodeCache: {
        ...s.nodeCache,
        [projectId]: (s.nodeCache[projectId] ?? []).filter((node) => node.id !== nodeId)
      }
    }))
  },

  async close(id: string) {
    await window.termsprawl.workspace.closeProject(id)
    set((s) => {
      const projects = s.projects.map((p) => (p.id === id ? { ...p, closed: true } : p))
      const wasActive = s.activeProjectId === id
      const nextOpen = projects.find((p) => !p.closed && !p.archived)
      return { projects, activeProjectId: wasActive ? (nextOpen?.id ?? null) : s.activeProjectId }
    })
  },

  async archive(id: string) {
    await window.termsprawl.workspace.archiveProject(id)
    set((s) => {
      const projects = s.projects.map((p) =>
        p.id === id ? { ...p, closed: true, archived: true } : p
      )
      const wasActive = s.activeProjectId === id
      const nextOpen = projects.find((p) => !p.closed && !p.archived)
      return { projects, activeProjectId: wasActive ? (nextOpen?.id ?? null) : s.activeProjectId }
    })
  },

  async reopen(id: string) {
    await window.termsprawl.workspace.reopenProject(id)
    set((s) => ({
      projects: s.projects.map((p) => (p.id === id ? { ...p, closed: false, archived: false } : p)),
      activeProjectId: id
    }))
  },

  async delete(id: string) {
    const result = await window.termsprawl.workspace.deleteProject(id)
    set((s) => {
      const projects = s.projects.filter((p) => p.id !== id)
      const wasActive = s.activeProjectId === id
      const nextOpen = projects.find((p) => !p.closed && !p.archived)
      const { [id]: _dropped, ...nodeCache } = s.nodeCache
      const { [id]: _droppedTombstones, ...tombstonedNodeIds } = s.tombstonedNodeIds
      return {
        projects,
        nodeCache,
        tombstonedNodeIds,
        activeProjectId: wasActive ? (nextOpen?.id ?? null) : s.activeProjectId
      }
    })
    return result
  },

  async updateSettings(id: string, patch: ProjectSettings) {
    await window.termsprawl.workspace.updateSettings(id, patch)
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === id ? { ...p, settings: { ...(p.settings ?? {}), ...patch } } : p
      )
    }))
  },

  async rename(id: string, name: string) {
    await window.termsprawl.workspace.renameProject(id, name)
    const trimmed = name.trim()
    if (!trimmed) return
    set((s) => ({
      projects: s.projects.map((p) => (p.id === id ? { ...p, name: trimmed } : p))
    }))
  }
}))
