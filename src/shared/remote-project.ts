// Remote project helpers — the shared contract for main (core) and renderer.
// Pure, no electron, no fs.

import type { ProjectRemote } from './types'

/** A project is remote when it declares a remote destination (cwd is null). */
export function isRemoteProject(project: { remote?: ProjectRemote; cwd?: string | null }): boolean {
  return project.remote != null
}

/** Human label for a remote destination, e.g. `root@box:22:/srv/x`. */
export function remoteLabel(remote: ProjectRemote): string {
  const user = remote.user ? `${remote.user}@` : ''
  const port = remote.port ? `:${remote.port}` : ''
  return `${user}${remote.host}${port}:${remote.path}`
}

/**
 * Normalize a user-entered remote destination. Trims whitespace, drops empty
 * user/port fields, and rejects a missing host or path (returns null). The
 * add-remote-project dialog validates input through this before persisting.
 */
export function normalizeRemote(input: ProjectRemote): ProjectRemote | null {
  const host = input.host.trim()
  const path = input.path.trim()
  if (!host || !path) return null
  const user = input.user?.trim() || undefined
  const port = input.port || undefined
  const out: ProjectRemote = { host, path }
  if (user) out.user = user
  if (port) out.port = port
  return out
}
