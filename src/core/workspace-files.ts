// Workspace persistence — pure file layout + serialization, no electron.
//
// Layout:
//   <userData>/workspace.json            — index of projects (id, name, cwd, closed)
//   <cwd>/.termsprawl/project.json       — a folder project's nodes (git-shareable)
//   <userData>/projects/<id>.json        — a cwd-less project's nodes (inline)
//
// The renderer's React Flow state is the single live source of truth; these
// files are the serialization layer.

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

export interface SerializedNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: Record<string, unknown>
}

export interface ProjectMeta {
  id: string
  name: string
  /** Project folder; null = cwd-less inline canvas. */
  cwd: string | null
  closed: boolean
  /** Archived = hidden from the tab bar, preserved; reopen restores it. */
  archived?: boolean
  /** Per-project settings (accent color, etc.), persisted in the index. */
  settings?: ProjectSettings
}

export interface ProjectSettings {
  accent?: string
}

export interface WorkspaceIndex {
  version: 1
  projects: ProjectMeta[]
  pendingTerminalCleanup?: PendingTerminalCleanup[]
  pendingTerminalNodeCleanup?: PendingTerminalCleanup[]
  terminalTombstones?: PendingTerminalCleanup[]
}

export interface PendingTerminalCleanup {
  projectId: string
  terminalId: string
}

export interface ProjectFile {
  version: 1
  rev: number
  nodes: SerializedNode[]
}

const INDEX_FILE = 'workspace.json'
const PROJECT_DIR = 'projects'
const PROJECT_FILE_NAME = 'project.json'
const PROJECT_FILE_DIR = '.termsprawl'
const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

export function isSafeProjectId(id: unknown): id is string {
  return typeof id === 'string' && PROJECT_ID_PATTERN.test(id)
}

export function indexPath(userDataPath: string): string {
  return join(userDataPath, INDEX_FILE)
}

export function inlineProjectPath(userDataPath: string, projectId: string): string {
  if (!isSafeProjectId(projectId)) throw new Error(`Invalid project id: ${projectId}`)
  return join(userDataPath, PROJECT_DIR, `${projectId}.json`)
}

/** Folder projects store nodes in <cwd>/.termsprawl/project.json. */
export function folderProjectPath(cwd: string): string {
  return join(cwd, PROJECT_FILE_DIR, PROJECT_FILE_NAME)
}

/** Read the index; returns an empty one when nothing exists yet. */
export function loadIndex(userDataPath: string): WorkspaceIndex {
  try {
    const raw = readFileSync(indexPath(userDataPath), 'utf8')
    const parsed = JSON.parse(raw) as WorkspaceIndex
    if (parsed.version !== 1 || !Array.isArray(parsed.projects)) throw new Error('bad index')
    return {
      ...parsed,
      projects: parsed.projects.filter((project) => isSafeProjectId(project?.id)),
      pendingTerminalCleanup: (parsed.pendingTerminalCleanup ?? []).filter(
        (entry) => isSafeProjectId(entry?.projectId) && isSafeProjectId(entry?.terminalId)
      ),
      pendingTerminalNodeCleanup: (parsed.pendingTerminalNodeCleanup ?? []).filter(
        (entry) => isSafeProjectId(entry?.projectId) && isSafeProjectId(entry?.terminalId)
      ),
      terminalTombstones: (parsed.terminalTombstones ?? []).filter(
        (entry) => isSafeProjectId(entry?.projectId) && isSafeProjectId(entry?.terminalId)
      )
    }
  } catch {
    return { version: 1, projects: [] }
  }
}

export function saveIndex(userDataPath: string, index: WorkspaceIndex): void {
  if (index.projects.some((project) => !isSafeProjectId(project.id))) {
    throw new Error('Workspace index contains an invalid project id')
  }
  if ((index.pendingTerminalCleanup ?? []).some(
    (entry) => !isSafeProjectId(entry.projectId) || !isSafeProjectId(entry.terminalId)
  )) {
    throw new Error('Workspace index contains an invalid pending terminal cleanup id')
  }
  for (const entries of [index.pendingTerminalNodeCleanup ?? [], index.terminalTombstones ?? []]) {
    if (entries.some((entry) => !isSafeProjectId(entry.projectId) || !isSafeProjectId(entry.terminalId))) {
      throw new Error('Workspace index contains an invalid terminal node cleanup id')
    }
  }
  mkdirSync(userDataPath, { recursive: true })
  const path = indexPath(userDataPath)
  atomicWriteFile(path, JSON.stringify(index, null, 2))
}

export type AtomicTempWriter = (temporaryPath: string, contents: string) => void

/** Replace a file with a fully-written sibling so partial writes never touch the live path. */
export function atomicWriteFile(
  path: string,
  contents: string,
  writeTemporary: AtomicTempWriter = (temporaryPath, value) =>
    writeFileSync(temporaryPath, value, 'utf8')
): void {
  const temporaryPath = `${path}.${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`
  try {
    writeTemporary(temporaryPath, contents)
    renameSync(temporaryPath, path)
  } catch (error) {
    try {
      rmSync(temporaryPath, { force: true })
    } catch {
      // Preserve the original write/rename error.
    }
    throw error
  }
}

/** Read a project's nodes; returns null when the file is missing. */
export function loadProjectFile(userDataPath: string, project: ProjectMeta): ProjectFile | null {
  const path = project.cwd ? folderProjectPath(project.cwd) : inlineProjectPath(userDataPath, project.id)
  try {
    if (!existsSync(path)) {
      // A crash can occur after metadata is staged but before workspace.json is
      // committed. If the index still references this project, restore that
      // staged file so the project never appears empty on the next launch.
      const prefix = `${basename(path)}.`
      const stagedName = readdirSync(dirname(path))
        .filter((name) => name.startsWith(prefix) && name.endsWith('.delete'))
        .sort()
        .at(-1)
      if (stagedName) renameSync(join(dirname(path), stagedName), path)
    }
    const raw = readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw) as ProjectFile
    if (parsed.version !== 1 || !Array.isArray(parsed.nodes)) throw new Error('bad project file')
    return parsed
  } catch {
    return null
  }
}

/** Write a project's nodes. Returns the new rev (monotonic). */
export function saveProjectFile(
  userDataPath: string,
  project: ProjectMeta,
  nodes: SerializedNode[],
  baseRev: number
): number {
  const rev = baseRev + 1
  const file: ProjectFile = { version: 1, rev, nodes }
  const contents = JSON.stringify(file, null, 2)
  if (project.cwd) {
    mkdirSync(join(project.cwd, PROJECT_FILE_DIR), { recursive: true })
    atomicWriteFile(folderProjectPath(project.cwd), contents)
  } else {
    const path = inlineProjectPath(userDataPath, project.id)
    mkdirSync(dirname(path), { recursive: true })
    atomicWriteFile(path, contents)
  }
  return rev
}

/** True when a folder already carries a project file (adoption). */
export function folderHasProject(cwd: string): boolean {
  return existsSync(folderProjectPath(cwd))
}

export interface StagedProjectFileRemoval {
  commit(): void
  rollback(): void
}

/** Atomically move project metadata aside before the workspace index commits.
 * The caller must commit or roll back the staged removal. */
export function stageProjectFileRemoval(
  userDataPath: string,
  project: ProjectMeta
): StagedProjectFileRemoval | null {
  const path = project.cwd ? folderProjectPath(project.cwd) : inlineProjectPath(userDataPath, project.id)
  if (!existsSync(path)) return null

  const stagedPath = `${path}.${process.pid}-${Date.now()}.delete`
  renameSync(path, stagedPath)
  return {
    commit(): void {
      rmSync(stagedPath, { force: true })
    },
    rollback(): void {
      if (existsSync(stagedPath)) renameSync(stagedPath, path)
    }
  }
}
