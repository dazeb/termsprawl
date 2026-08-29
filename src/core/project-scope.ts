// Shared project-scope validators (audit B1): both the Electron main process
// and the Server Edition handlers must confine file/git/terminal operations to
// KNOWN PROJECTS. One implementation, two consumers — the drift between them
// was the critical. Electron-free.
//
// A "known project" is an entry in the workspace snapshot: a local project is
// identified by its cwd; a remote project by host/user/port/path.

import type { WorkspaceStore } from './workspace-store'
import type { ProjectRemote, GitTarget } from '../shared/types'

export interface ProjectScope {
  kind: 'local'
  cwd: string
  projectId: string
}

export interface RemoteScope {
  kind: 'remote'
  remote: ProjectRemote
  projectId: string
}

export type ScopeResult = ProjectScope | RemoteScope | { kind: 'none'; reason: string }

/** True when `cwd` is exactly the cwd of a known local project. */
export function isKnownProjectCwd(store: WorkspaceStore, cwd: string): boolean {
  return store.snapshot().index.projects.some((p) => p.cwd === cwd)
}

/** Resolve a GitTarget ({cwd} | {remote}) to a known project, or none.
 * NEVER accepts an arbitrary cwd that isn't a registered project. */
export function resolveGitScope(store: WorkspaceStore, target: GitTarget | undefined | null): ScopeResult {
  if (!target) return { kind: 'none', reason: 'no target' }
  if (target.remote) {
    const match = store.snapshot().index.projects.find(
      (p) =>
        p.remote !== undefined &&
        p.remote.host === target.remote!.host &&
        (p.remote.user ?? 'root') === (target.remote!.user ?? 'root') &&
        (p.remote.port ?? 22) === (target.remote!.port ?? 22) &&
        p.remote.path === target.remote!.path
    )
    if (!match) return { kind: 'none', reason: 'remote is not a known project' }
    return { kind: 'remote', remote: match.remote as ProjectRemote, projectId: match.id }
  }
  const cwd = target.cwd ?? ''
  if (!cwd || !isKnownProjectCwd(store, cwd)) return { kind: 'none', reason: 'cwd is not a known project' }
  const project = store.snapshot().index.projects.find((p) => p.cwd === cwd)
  return { kind: 'local', cwd, projectId: project!.id }
}

/** Confine a file path to a known local project's folder. Returns the
 * resolved absolute path or a refusal. `pathHint` may carry the projectId
 * explicitly (shim sends it); when absent the path must resolve under some
 * known project cwd. */
export function resolveFileScope(
  store: WorkspaceStore,
  absPath: string,
  hint?: { cwd?: string; projectId?: string }
): { ok: true; cwd: string; projectId: string; path: string } | { ok: false; reason: string } {
  const projects = store.snapshot().index.projects
  let candidates = projects.filter((p) => p.cwd)
  if (hint?.projectId) {
    const byId = projects.find((p) => p.id === hint.projectId)
    if (byId?.cwd) candidates = [byId]
  }
  if (hint?.cwd) {
    const byCwd = projects.find((p) => p.cwd === hint.cwd)
    if (byCwd?.cwd) candidates = [byCwd]
  }
  const norm = (p: string): string => p.replace(/\/+$/, '')
  for (const project of candidates) {
    const root = norm(project.cwd as string)
    if (absPath === root || absPath.startsWith(root + '/')) {
      return { ok: true, cwd: root, projectId: project.id, path: absPath }
    }
  }
  return { ok: false, reason: 'path is outside every known project folder' }
}

/** PtyCreateRequest gate: terminals may only spawn INSIDE a known project
 * cwd, and arbitrary commands are a desktop-renderer-only affordance (the
 * Server Edition refuses them — a WS client must not get command execution). */
export function resolvePtyScope(
  store: WorkspaceStore,
  req: { cwd?: string | null; command?: string; remote?: unknown; id?: string },
  opts: { allowCommands: boolean }
): { ok: true } | { ok: false; reason: string } {
  if (req.command && !opts.allowCommands) {
    return { ok: false, reason: 'arbitrary commands are not permitted over the server bridge' }
  }
  if (req.remote) {
    // remote terminals: must reference a known remote project (path match)
    const remote = req.remote as ProjectRemote
    const known = store.snapshot().index.projects.some(
      (p) =>
        p.remote !== undefined &&
        p.remote.host === remote.host &&
        (p.remote.user ?? 'root') === (remote.user ?? 'root') &&
        (p.remote.port ?? 22) === (remote.port ?? 22) &&
        p.remote.path === remote.path
    )
    if (!known) return { ok: false, reason: 'remote is not a known project' }
    return { ok: true }
  }
  const cwd = req.cwd ?? ''
  if (!cwd || !isKnownProjectCwd(store, cwd)) {
    return { ok: false, reason: 'cwd is not a known project' }
  }
  return { ok: true }
}
