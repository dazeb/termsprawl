// Phase 9 — remote git ops over ssh. Mirrors the local git-service surface but
// runs `git -C <remotePath>` through runSsh — argv-array, no remote shell string
// for git commands (git -C changes dir itself). Electron-free.
import { runSsh, type RemoteHost } from './ssh'
import type { GitResult } from '../shared/types'

export function toGitResult(code: number, stdout: string, stderr: string): GitResult {
  return { code, stdout, stderr }
}

/** Build the argv for a remote git command run in `<remotePath>`. */
export function remoteGitArgs(remotePath: string, args: string[]): string[] {
  return ['git', '-C', remotePath, '-c', 'color.ui=false', ...args]
}

/** Remote `git status --porcelain` (raw porcelain text; parse on the caller). */
export async function remoteGitStatus(
  remote: RemoteHost,
  remotePath: string
): Promise<GitResult> {
  const r = await runSsh(remote, remoteGitArgs(remotePath, ['status', '--porcelain']))
  return toGitResult(r.code, r.stdout, r.stderr)
}

/** Remote `git commit -m <message>` in `<remotePath>`. */
export async function remoteGitCommit(
  remote: RemoteHost,
  remotePath: string,
  message: string
): Promise<GitResult> {
  const r = await runSsh(remote, remoteGitArgs(remotePath, ['commit', '-m', message]))
  return toGitResult(r.code, r.stdout, r.stderr)
}
