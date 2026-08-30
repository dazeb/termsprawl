// Space snapshot helpers for the DESKTOP sync loop (Phase 15, Tasks D1+D2).
// Pure and Electron-free: the import decision (what the new local project is
// called, which project a snapshot points at) and the push-payload assembly
// (active project + scrollbacks + rev) live here; the Electron main process
// and the Server Edition supply the I/O. Mirrors the payload shape of
// core/space-sync.ts and the wiring in server/space-sync-wiring.ts.
import type { SerializedNode } from './workspace-files'
import type { SpaceSnapshotPayload } from './space-sync'

/** The workspace envelope a space snapshot carries (shape of
 * WorkspaceSnapshot plus the rev map the Server Edition's boot-restore
 * compares before applying anything). */
export interface SnapshotWorkspace {
  index: {
    version?: 1
    projects: Array<{
      id: string
      name: string
      cwd: string | null
      closed?: boolean
      archived?: boolean
      [key: string]: unknown
    }>
  }
  projects: Record<string, SerializedNode[]>
  currentProjectId?: string
  /** Per-project rev — boot restore applies only strictly newer projects, so
   * a push without revs is silently ignored on the space's next boot. */
  revs?: Record<string, number>
}

/** The current project of a pulled snapshot: the one `currentProjectId`
 * points at, else the first open project, else the first project at all. */
export function snapshotCurrentProject(workspace: SnapshotWorkspace | undefined): {
  id: string
  name: string
  cwd: string | null
  nodes: SerializedNode[]
} | null {
  if (!workspace?.index?.projects) return null
  const projects = workspace.index.projects
  const nodesFor = (id: string): SerializedNode[] =>
    Array.isArray(workspace.projects?.[id]) ? workspace.projects[id] : []
  const byId = (id: string | undefined): (typeof projects)[number] | undefined =>
    id ? projects.find((p) => p.id === id) : undefined
  const current =
    byId(workspace.currentProjectId) ??
    projects.find((p) => !p.closed && !p.archived) ??
    projects[0]
  if (!current) return null
  return { id: current.id, name: current.name, cwd: current.cwd ?? null, nodes: nodesFor(current.id) }
}

/** Locale date used in imported project names, e.g. "30/08/2026". */
function localeDate(d = new Date()): string {
  return d.toLocaleDateString()
}

/** The unique name for the imported project: `<name> (online, <date>)`, with
 * ` 2`, ` 3`, … appended while an existing project already uses the name.
 * NEVER overwrites — the caller creates a fresh project under this name. */
export function uniqueOnlineSnapshotName(
  baseName: string,
  existingNames: readonly string[],
  now = new Date()
): string {
  const base = `${baseName.trim() || 'Canvas'} (online, ${localeDate(now)})`
  const taken = new Set(existingNames)
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base} ${n}`)) n += 1
  return `${base} ${n}`
}

/** A buildable view of the active project for the push payload. */
export interface PushProjectInput {
  id: string
  name: string
  cwd: string | null
  /** Serialized nodes (the same shape the app persists). */
  nodes: SerializedNode[]
  /** The project file's monotonic rev, or 0 when unknown. Boot restore
   * applies only strictly newer snapshots — a missing/old rev means the
   * space ignores the push, so this must travel with the payload. */
  rev: number
  /** The folder project's .termsprawl/project.json content, when the
   * project has a folder and the file could be read. */
  projectFile?: unknown
}

/** Assemble the push payload for ONE project (the active one): a workspace
 * envelope carrying just that project plus its rev, the folder-project file
 * when present, and the terminal scrollbacks. Shape-compatible with
 * SpaceSnapshotPayload, so the space's boot restore reads it unchanged. */
export function buildProjectPushPayload(
  project: PushProjectInput,
  scrollbacks: Record<string, string>
): SpaceSnapshotPayload {
  const meta = { id: project.id, name: project.name, cwd: project.cwd }
  const workspace: SnapshotWorkspace = {
    index: { version: 1, projects: [meta] },
    projects: { [project.id]: project.nodes },
    currentProjectId: project.id,
    revs: { [project.id]: project.rev }
  }
  const files: Record<string, unknown> =
    project.cwd && project.projectFile !== undefined
      ? { [`${project.cwd}/.termsprawl/project.json`]: project.projectFile }
      : {}
  return { workspace, files, scrollbacks }
}
