// Shared project-scope validators (audit B1): both the Electron main process
// and the Server Edition handlers must confine file/git/terminal operations to
// KNOWN PROJECTS. One implementation, two consumers — the drift between them
// was the critical. Electron-free.
//
// A "known project" is an entry in the workspace snapshot: a local project is
// identified by its cwd; a remote project by host/user/port/path.

import type { WorkspaceStore } from './workspace-store'
import type { ProjectRemote, GitTarget } from '../shared/types'
import { agentConfig, agentIds } from '../shared/agents/config'

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

/** PtyCreateRequest gate for the SERVER bridge. Terminals must live in a known
 * project OR have no cwd at all (cwd-less projects — Welcome, cloud-restored
 * canvases — start the shell in the process workdir; inside a per-user space
 * container that IS the user's sandbox). Commands: the renderer can only
 * produce the shared agent presets (`claude|codex|gemini|grok`) and `druk`, so
 * exactly those are allowed — each is no more capable than the interactive
 * shell a user already gets, and node commands AUTO-RUN on open, which is why
 * an allowlist (not arbitrary strings) is the boundary here. Unknown explicit
 * cwds and unknown commands stay refused. The desktop renderer path never
 * calls this gate (its own renderer is trusted). */
export function resolvePtyScope(
  store: WorkspaceStore,
  req: { cwd?: string | null; command?: string; remote?: unknown; id?: string },
  opts: { allowCommands: boolean }
): { ok: true } | { ok: false; reason: string } {
  if (req.command && !opts.allowCommands) {
    // The agent presets + druk editor preset are the commands the renderer's
    // own factories can produce (shared/agents/config.ts + workspace.ts);
    // anything else is not a shape this app's UI emits.
    const first = req.command.trim().split(/\s+/)[0]
    const isPreset =
      agentIds().some((id) => agentConfig(id).enabled && first === agentConfig(id).command) ||
      first === 'druk'
    if (!isPreset) {
      return { ok: false, reason: 'command is not an agent or editor preset' }
    }
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
  // No cwd at all is legitimate (cwd-less projects: the shell starts in the
  // server's workdir). An EXPLICIT cwd must belong to a known project.
  if (req.cwd && !isKnownProjectCwd(store, req.cwd)) {
    return { ok: false, reason: 'cwd is not a known project' }
  }
  return { ok: true }
}
