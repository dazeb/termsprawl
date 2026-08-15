// Projects store — project metadata + serialized nodes, backed by the
// workspace IPC. React Flow remains the single live source of truth for the
// ACTIVE project's nodes; this store holds the list and the disk contract.

import { create } from 'zustand'
import type { ProjectMeta, SerializedNode } from '@shared/types'

interface ProjectsState {
  projects: ProjectMeta[]
  activeProjectId: string | null
  /** Per-project serialized nodes, loaded from disk. */
  nodeCache: Record<string, SerializedNode[]>
  loaded: boolean

  load(): Promise<void>
  select(id: string): void
  /** Create a project (folder or inline); returns its meta. */
  create(name: string, cwd: string | null): Promise<ProjectMeta>
  /** Persist the active project's nodes. */
  saveNodes(nodes: SerializedNode[]): Promise<void>
  closeActive(): Promise<void>
  archiveActive(): Promise<void>
  reopen(id: string): Promise<void>
  delete(id: string): Promise<void>
}

export const useProjects = create<ProjectsState>((set, get) => ({
  projects: [],
  activeProjectId: null,
  nodeCache: {},
  loaded: false,

  async load() {
    const snap = await window.termsprawl.workspace.snapshot()
    const open = snap.index.projects.filter((p) => !p.closed)
    set({
      projects: snap.index.projects,
      nodeCache: snap.projects,
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
      activeProjectId: project.id
    }))
    return project
  },

  async saveNodes(nodes: SerializedNode[]) {
    const id = get().activeProjectId
    if (!id) return
    await window.termsprawl.workspace.saveNodes(id, nodes)
    set((s) => ({ nodeCache: { ...s.nodeCache, [id]: nodes } }))
  },

  async closeActive() {
    const id = get().activeProjectId
    if (!id) return
    await window.termsprawl.workspace.closeProject(id)
    set((s) => {
      const projects = s.projects.map((p) => (p.id === id ? { ...p, closed: true } : p))
      const nextOpen = projects.find((p) => !p.closed && !p.archived)
      return { projects, activeProjectId: nextOpen?.id ?? null }
    })
  },

  async archiveActive() {
    const id = get().activeProjectId
    if (!id) return
    await window.termsprawl.workspace.archiveProject(id)
    set((s) => {
      const projects = s.projects.map((p) =>
        p.id === id ? { ...p, closed: true, archived: true } : p
      )
      const nextOpen = projects.find((p) => !p.closed && !p.archived)
      return { projects, activeProjectId: nextOpen?.id ?? null }
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
    await window.termsprawl.workspace.deleteProject(id)
    set((s) => ({
      projects: s.projects.filter((p) => p.id !== id),
      activeProjectId: s.activeProjectId === id ? null : s.activeProjectId
    }))
  }
}))
