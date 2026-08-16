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

  addProject(name: string, cwd: string | null): ProjectMeta {
    const id = `p-${Date.now().toString(36)}`
    const project: ProjectMeta = { id, name, cwd, closed: false, archived: false }
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

  /** Merge new per-project settings into the index and persist. */
  updateSettings(id: string, patch: ProjectSettings): void {
    const project = this.index.projects.find((p) => p.id === id)
    if (!project) return
    project.settings = { ...(project.settings ?? {}), ...patch }
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

  /** Save nodes for a project; returns the new monotonic rev. */
  saveNodes(id: string, nodes: SerializedNode[]): number {
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
      this.revs.get(id) ?? 0
    )
    this.revs.set(id, rev)
    return rev
  }

  /** Whether a folder already has a project file (adoption path). */
  hasFolderProject(cwd: string): boolean {
    return folderHasProject(cwd)
  }

  private persistIndex(): void {
    saveIndex(this.platform.userDataPath, this.index)
  }
}
