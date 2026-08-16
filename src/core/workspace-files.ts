// Workspace persistence — pure file layout + serialization, no electron.
//
// Layout:
//   <userData>/workspace.json            — index of projects (id, name, cwd, closed)
//   <cwd>/.termsprawl/project.json       — a folder project's nodes (git-shareable)
//   <userData>/projects/<id>.json        — a cwd-less project's nodes (inline)
//
// The renderer's React Flow state is the single live source of truth; these
// files are the serialization layer.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

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

export function indexPath(userDataPath: string): string {
  return join(userDataPath, INDEX_FILE)
}

export function inlineProjectPath(userDataPath: string, projectId: string): string {
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
    return parsed
  } catch {
    return { version: 1, projects: [] }
  }
}

export function saveIndex(userDataPath: string, index: WorkspaceIndex): void {
  mkdirSync(userDataPath, { recursive: true })
  writeFileSync(indexPath(userDataPath), JSON.stringify(index, null, 2), 'utf8')
}

/** Read a project's nodes; returns null when the file is missing. */
export function loadProjectFile(userDataPath: string, project: ProjectMeta): ProjectFile | null {
  const path = project.cwd ? folderProjectPath(project.cwd) : inlineProjectPath(userDataPath, project.id)
  try {
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
  if (project.cwd) {
    mkdirSync(join(project.cwd, PROJECT_FILE_DIR), { recursive: true })
    writeFileSync(folderProjectPath(project.cwd), JSON.stringify(file, null, 2), 'utf8')
  } else {
    const path = inlineProjectPath(userDataPath, project.id)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(file, null, 2), 'utf8')
  }
  return rev
}

/** True when a folder already carries a project file (adoption). */
export function folderHasProject(cwd: string): boolean {
  return existsSync(folderProjectPath(cwd))
}

/** Delete a project's file (inline project file, or the folder's project.json
 * for folder projects). Best-effort: missing files are fine. */
export function removeProjectFile(userDataPath: string, project: ProjectMeta): void {
  const path = project.cwd ? folderProjectPath(project.cwd) : inlineProjectPath(userDataPath, project.id)
  try {
    rmSync(path, { force: true })
  } catch {
    // already gone — fine
  }
}
