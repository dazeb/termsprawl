// Workspace store — the main-process service that owns project metadata and
// node persistence. The renderer keeps React Flow as the live source of truth;
// this store is the disk layer, addressed over IPC.
//
// Electron-free: constructed with a userDataPath from the platform seam.

import type { CorePlatform } from './platform'
import {
  folderHasProject,
  isSafeProjectId,
  loadIndex,
  loadProjectFile,
  saveIndex,
  saveProjectFile,
  stageProjectFileRemoval,
  type ProjectMeta,
  type ProjectSettings,
  type SerializedNode,
  type WorkspaceIndex
} from './workspace-files'
import type { NodeLink, ProjectRemote } from '../shared/types'

export interface WorkspaceSnapshot {
  index: WorkspaceIndex
  /** Nodes per project id; projects without a file come back as []. */
  projects: Record<string, SerializedNode[]>
}

export class WorkspaceStore {
  private index: WorkspaceIndex
  private readonly revs = new Map<string, number>()

  constructor(private readonly platform: CorePlatform) {
    this.index = loadIndex(platform.userDataPath)
    for (const project of this.index.projects) {
      const file = loadProjectFile(platform.userDataPath, project)
      this.revs.set(project.id, file?.rev ?? 0)
    }
  }

  snapshot(): WorkspaceSnapshot {
    const projects: Record<string, SerializedNode[]> = {}
    for (const project of this.index.projects) {
      projects[project.id] = loadProjectFile(this.platform.userDataPath, project)?.nodes ?? []
    }
    return { index: this.index, projects }
  }

  addProject(name: string, cwd: string | null, remote?: ProjectRemote, opts?: { id?: string }): ProjectMeta {
    // An explicit id (snapshot restore) keeps project ids stable across
    // machines — revs and node files stay comparable; ids are otherwise
    // time-derived. Ids are validated before anything touches disk.
    const id = opts?.id ?? `p-${Date.now().toString(36)}`
    if (!isSafeProjectId(id)) throw new Error(`Invalid project id: ${id}`)
    if (this.index.projects.some((p) => p.id === id)) {
      throw new Error(`Project already exists: ${id}`)
    }
    const project: ProjectMeta = {
      id,
      name,
      // A remote project has no local cwd; its destinations live on `remote`.
      cwd: remote ? null : cwd,
      ...(remote ? { remote } : {}),
      closed: false,
      archived: false
    }
    this.index.projects.push(project)
    this.revs.set(id, 0)
    this.persistIndex()
    return project
  }

  closeProject(id: string): void {
    const project = this.index.projects.find((p) => p.id === id)
    if (project) {
      project.closed = true
      this.persistIndex()
    }
  }

  /** Archive = close + hide from the tab bar; data and tmux sessions kept. */
  archiveProject(id: string): void {
    const project = this.index.projects.find((p) => p.id === id)
    if (project) {
      project.closed = true
      project.archived = true
      this.persistIndex()
    }
  }

  reopenProject(id: string): void {
    const project = this.index.projects.find((p) => p.id === id)
    if (project) {
      project.closed = false
      project.archived = false
      this.persistIndex()
    }
  }

  /** Merge new per-project settings into the index and persist.
   * Undefined-valued patch keys REMOVE their key (matching what
   * JSON.stringify persists) and an emptied settings object collapses to
   * undefined — so in-memory state always equals what a relaunch loads. */
  updateSettings(id: string, patch: ProjectSettings): void {
    const project = this.index.projects.find((p) => p.id === id)
    if (!project) return
    const merged: Record<string, unknown> = { ...(project.settings ?? {}), ...patch }
    for (const key of Object.keys(merged)) {
      if (merged[key] === undefined) delete merged[key]
    }
    project.settings = Object.keys(merged).length > 0 ? (merged as ProjectSettings) : undefined
    this.persistIndex()
  }

  /** Rename a project; persisted in the workspace index. */
  renameProject(id: string, name: string): void {
    const project = this.index.projects.find((p) => p.id === id)
    if (!project) return
    const trimmed = name.trim()
    if (!trimmed) return
    project.name = trimmed
    this.persistIndex()
  }

  deleteProject(id: string, pendingTerminalIds: string[] = []): void {
    const project = this.index.projects.find((p) => p.id === id)
    const originalIndex = this.index
    const nodeCleanupIds = (this.index.pendingTerminalNodeCleanup ?? [])
      .filter((entry) => entry.projectId === id)
      .map((entry) => entry.terminalId)
    const allPendingTerminalIds = [...new Set([...pendingTerminalIds, ...nodeCleanupIds])]
    const nextIndex: WorkspaceIndex = {
      ...this.index,
      projects: this.index.projects.filter((p) => p.id !== id),
      pendingTerminalCleanup: [
        ...(this.index.pendingTerminalCleanup ?? []),
        ...allPendingTerminalIds
          .filter((terminalId) => !(this.index.pendingTerminalCleanup ?? []).some(
            (entry) => entry.projectId === id && entry.terminalId === terminalId
          ))
          .map((terminalId) => ({ projectId: id, terminalId }))
      ],
      pendingTerminalNodeCleanup: (this.index.pendingTerminalNodeCleanup ?? []).filter(
        (entry) => entry.projectId !== id
      ),
      terminalTombstones: (this.index.terminalTombstones ?? []).filter(
        (entry) => entry.projectId !== id
      )
    }
    const stagedRemoval = project
      ? stageProjectFileRemoval(this.platform.userDataPath, project)
      : null
    let indexSaved = false
    try {
      saveIndex(this.platform.userDataPath, nextIndex)
      indexSaved = true
      stagedRemoval?.commit()
    } catch (error) {
      const rollbackErrors: unknown[] = []
      if (indexSaved) {
        try {
          saveIndex(this.platform.userDataPath, originalIndex)
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError)
        }
      }
      try {
        stagedRemoval?.rollback()
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
      if (rollbackErrors.length > 0) {
        throw new AggregateError([error, ...rollbackErrors], 'Project deletion and rollback failed')
      }
      throw error
    }
    this.index = nextIndex
    this.revs.delete(id)
  }

  pendingTerminalIdsForProject(projectId: string): string[] {
    return (this.index.pendingTerminalCleanup ?? [])
      .filter((entry) => entry.projectId === projectId)
      .map((entry) => entry.terminalId)
  }

  pendingTerminalCleanup(): Array<{ projectId: string; terminalId: string }> {
    return [...(this.index.pendingTerminalCleanup ?? [])]
  }

  completeTerminalCleanup(terminalIds: string[]): void {
    if (terminalIds.length === 0) return
    const completed = new Set(terminalIds)
    const nextIndex: WorkspaceIndex = {
      ...this.index,
      pendingTerminalCleanup: (this.index.pendingTerminalCleanup ?? []).filter(
        (entry) => !completed.has(entry.terminalId)
      )
    }
    saveIndex(this.platform.userDataPath, nextIndex)
    this.index = nextIndex
  }

  stageTerminalNodeClose(projectId: string, terminalId: string): void {
    if (!isSafeProjectId(terminalId)) throw new Error(`Invalid terminal id: ${terminalId}`)
    if (!this.index.projects.some((project) => project.id === projectId)) {
      throw new Error(`Unknown project: ${projectId}`)
    }
    const entry = { projectId, terminalId }
    const hasEntry = (entries: Array<{ projectId: string; terminalId: string }> | undefined): boolean =>
      (entries ?? []).some((item) => item.projectId === projectId && item.terminalId === terminalId)
    const nextIndex: WorkspaceIndex = {
      ...this.index,
      pendingTerminalNodeCleanup: hasEntry(this.index.pendingTerminalNodeCleanup)
        ? this.index.pendingTerminalNodeCleanup
        : [...(this.index.pendingTerminalNodeCleanup ?? []), entry],
      terminalTombstones: hasEntry(this.index.terminalTombstones)
        ? this.index.terminalTombstones
        : [...(this.index.terminalTombstones ?? []), entry]
    }
    saveIndex(this.platform.userDataPath, nextIndex)
    this.index = nextIndex
  }

  pendingTerminalNodeCleanup(): Array<{ projectId: string; terminalId: string }> {
    return [...(this.index.pendingTerminalNodeCleanup ?? [])]
  }

  removeTerminalNode(projectId: string, terminalId: string): void {
    const current = this.snapshot().projects[projectId] ?? []
    this.saveNodes(projectId, current.filter((node) => node.id !== terminalId))
  }

  completeTerminalNodeClose(projectId: string, terminalId: string): void {
    const nextIndex: WorkspaceIndex = {
      ...this.index,
      pendingTerminalNodeCleanup: (this.index.pendingTerminalNodeCleanup ?? []).filter(
        (entry) => entry.projectId !== projectId || entry.terminalId !== terminalId
      )
    }
    saveIndex(this.platform.userDataPath, nextIndex)
    this.index = nextIndex
  }

  /**
   * A fresh process cannot have delayed renderer saves from the prior run.
   * Retire only tombstones whose node/session cleanup is no longer pending.
   */
  retireCompletedTerminalTombstones(): void {
    const pending = new Set(
      (this.index.pendingTerminalNodeCleanup ?? []).map(
        (entry) => `${entry.projectId}\0${entry.terminalId}`
      )
    )
    const terminalTombstones = (this.index.terminalTombstones ?? []).filter((entry) =>
      pending.has(`${entry.projectId}\0${entry.terminalId}`)
    )
    if (terminalTombstones.length === (this.index.terminalTombstones ?? []).length) return
    const nextIndex: WorkspaceIndex = { ...this.index, terminalTombstones }
    saveIndex(this.platform.userDataPath, nextIndex)
    this.index = nextIndex
  }

  /** Save nodes for a project; returns the new monotonic rev. Links are
   * preserved from the existing file when not supplied (node saves are
   * frequent; link edits are explicit). */
  saveNodes(id: string, nodes: SerializedNode[], links?: NodeLink[]): number {
    const project = this.index.projects.find((p) => p.id === id)
    if (!project) return 0
    const tombstones = new Set(
      (this.index.terminalTombstones ?? [])
        .filter((entry) => entry.projectId === id)
        .map((entry) => entry.terminalId)
    )
    const filteredNodes = nodes.filter((node) => !tombstones.has(node.id))
    const rev = saveProjectFile(
      this.platform.userDataPath,
      project,
      filteredNodes,
      this.revs.get(id) ?? 0,
      links
    )
    this.revs.set(id, rev)
    return rev
  }

  /** Persisted links for a project (empty when none). */
  linksFor(id: string): NodeLink[] {
    const project = this.index.projects.find((p) => p.id === id)
    if (!project) return []
    return loadProjectFile(this.platform.userDataPath, project)?.links ?? []
  }

  /** Persist links for a project; returns the new monotonic rev. */
  saveLinks(id: string, links: NodeLink[]): number {
    const project = this.index.projects.find((p) => p.id === id)
    if (!project) return 0
    const nodes = loadProjectFile(this.platform.userDataPath, project)?.nodes ?? []
    return this.saveNodes(id, nodes, links)
  }

  /** Every persisted link across all projects (scheduler mirror). */
  allLinks(): NodeLink[] {
    const out: NodeLink[] = []
    for (const project of this.index.projects) {
      out.push(...(loadProjectFile(this.platform.userDataPath, project)?.links ?? []))
    }
    return out
  }

  /** Locate a link by id across projects. */
  findLink(linkId: string): { link: NodeLink; projectId: string } | null {
    for (const project of this.index.projects) {
      const link = loadProjectFile(this.platform.userDataPath, project)?.links?.find((l) => l.id === linkId)
      if (link) return { link, projectId: project.id }
    }
    return null
  }

  /** Best-effort lastRun status write for one link. */
  recordLinkRun(projectId: string, linkId: string, at: number, ok: boolean, summary: string): void {
    const project = this.index.projects.find((p) => p.id === projectId)
    if (!project) return
    const links = loadProjectFile(this.platform.userDataPath, project)?.links ?? []
    if (!links.some((l) => l.id === linkId)) return
    const next = links.map((l) => (l.id === linkId ? { ...l, lastRun: { at, ok, summary } } : l))
    try {
      this.saveLinks(projectId, next)
    } catch {
      // status is cosmetic — never fail a run over it
    }
  }

  /** Whether a folder already has a project file (adoption path). */
  hasFolderProject(cwd: string): boolean {
    return folderHasProject(cwd)
  }

  private persistIndex(): void {
    saveIndex(this.platform.userDataPath, this.index)
  }
}
