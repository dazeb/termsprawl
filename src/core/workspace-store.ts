// Workspace store — the main-process service that owns project metadata and
// node persistence. The renderer keeps React Flow as the live source of truth;
// this store is the disk layer, addressed over IPC.
//
// Electron-free: constructed with a userDataPath from the platform seam.

import type { CorePlatform } from './platform'
import {
  folderHasProject,
  loadIndex,
  loadProjectFile,
  saveIndex,
  saveProjectFile,
  type ProjectMeta,
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
    const project: ProjectMeta = { id, name, cwd, closed: false }
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

  reopenProject(id: string): void {
    const project = this.index.projects.find((p) => p.id === id)
    if (project) {
      project.closed = false
      this.persistIndex()
    }
  }

  deleteProject(id: string): void {
    this.index.projects = this.index.projects.filter((p) => p.id !== id)
    this.revs.delete(id)
    this.persistIndex()
  }

  /** Save nodes for a project; returns the new monotonic rev. */
  saveNodes(id: string, nodes: SerializedNode[]): number {
    const project = this.index.projects.find((p) => p.id === id)
    if (!project) return 0
    const rev = saveProjectFile(
      this.platform.userDataPath,
      project,
      nodes,
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
