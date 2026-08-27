// Phase 9 — remote git ops over ssh. Mirrors the local git-service surface but
// runs `git -C <remotePath>` through runSsh — argv-array, no remote shell string
// for git commands (git -C changes dir itself). Electron-free.
//
// Every op takes an optional `SshOptions` (controlPath) so repeated calls for
// one project multiplex over a single ControlMaster connection (main threads
// `sshControlPath(userDataPath, remote)` in).
import { runSsh, type RemoteHost, type SshOptions } from './ssh'
import type { GitResult } from '../shared/types'
import { parseGitStatus, parseSyncState } from './git-service'
import type { GitBranchInfo, GitCommitInfo, GitFileChange, GitSyncState } from '../shared/types'

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
  remotePath: string,
  opts?: SshOptions
): Promise<GitResult> {
  const r = await runSsh(remote, remoteGitArgs(remotePath, ['status', '--porcelain']), opts)
  return toGitResult(r.code, r.stdout, r.stderr)
}

/** Remote `git status --porcelain` parsed into changes (mirror gitStatus). */
export async function remoteGitStatusChanges(
  remote: RemoteHost,
  repoRoot: string,
  opts?: SshOptions
): Promise<GitFileChange[]> {
  const res = await remoteGitStatus(remote, repoRoot, opts)
  return res.code === 0 ? parseGitStatus(res.stdout) : []
}

/** Remote `git commit -m <message>` in `<remotePath>`. */
export async function remoteGitCommit(
  remote: RemoteHost,
  remotePath: string,
  message: string,
  opts?: SshOptions
): Promise<GitResult> {
  const r = await runSsh(remote, remoteGitArgs(remotePath, ['commit', '-m', message]), opts)
  return toGitResult(r.code, r.stdout, r.stderr)
}

/** Resolve the enclosing repo root for a remote path (mirror findRepoRoot):
 * `git -C <path> rev-parse --show-toplevel`. Returns null when the path is not
 * inside a git repo on the remote. */
export async function remoteRepoRoot(
  remote: RemoteHost,
  path: string,
  opts?: SshOptions
): Promise<string | null> {
  const r = await runSsh(remote, remoteGitArgs(path, ['rev-parse', '--show-toplevel']), opts)
  return r.code === 0 ? r.stdout.trim() : null
}

export async function remoteCurrentBranch(
  remote: RemoteHost,
  repoRoot: string,
  opts?: SshOptions
): Promise<string> {
  const r = await runSsh(remote, remoteGitArgs(repoRoot, ['branch', '--show-current']), opts)
  return r.code === 0 ? r.stdout.trim() : ''
}

export async function remoteListBranches(
  remote: RemoteHost,
  repoRoot: string,
  opts?: SshOptions
): Promise<GitBranchInfo[]> {
  const r = await runSsh(
    remote,
    remoteGitArgs(repoRoot, ['branch', '--format=%(HEAD)%09%(refname:short)']),
    opts
  )
  if (r.code !== 0) return []
  const branches: GitBranchInfo[] = []
  for (const line of r.stdout.split('\n')) {
    if (!line) continue
    const tab = line.indexOf('\t')
    if (tab === -1) continue
    branches.push({ name: line.slice(tab + 1), current: line[0] === '*' })
  }
  return branches
}

export async function remoteSyncState(
  remote: RemoteHost,
  repoRoot: string,
  opts?: SshOptions
): Promise<GitSyncState> {
  const r = await runSsh(remote, remoteGitArgs(repoRoot, ['status', '-sb', '--porcelain=1']), opts)
  if (r.code !== 0) return { upstream: null, ahead: 0, behind: 0 }
  const first = r.stdout.split('\n')[0] ?? ''
  return parseSyncState(first)
}

export async function remoteRemoteUrl(
  remote: RemoteHost,
  repoRoot: string,
  name = 'origin',
  opts?: SshOptions
): Promise<string | null> {
  const r = await runSsh(remote, remoteGitArgs(repoRoot, ['remote', 'get-url', name]), opts)
  return r.code === 0 ? r.stdout.trim() : null
}

export async function remoteStageChanges(
  remote: RemoteHost,
  repoRoot: string,
  paths: string[],
  opts?: SshOptions
): Promise<GitResult> {
  const r = await runSsh(remote, remoteGitArgs(repoRoot, ['add', '-A', '--', ...paths]), opts)
  return toGitResult(r.code, r.stdout, r.stderr)
}

export async function remoteUnstageChanges(
  remote: RemoteHost,
  repoRoot: string,
  paths: string[],
  opts?: SshOptions
): Promise<GitResult> {
  const r = await runSsh(remote, remoteGitArgs(repoRoot, ['restore', '--staged', '--', ...paths]), opts)
  return toGitResult(r.code, r.stdout, r.stderr)
}

/** Restore remote working-tree files to HEAD, discarding uncommitted edits. */
export async function remoteDiscardChanges(
  remote: RemoteHost,
  repoRoot: string,
  paths: string[],
  opts?: SshOptions
): Promise<GitResult> {
  const r = await runSsh(remote, remoteGitArgs(repoRoot, ['checkout', '--', ...paths]), opts)
  return toGitResult(r.code, r.stdout, r.stderr)
}

export async function remoteCreateBranch(
  remote: RemoteHost,
  repoRoot: string,
  name: string,
  opts?: SshOptions
): Promise<GitResult> {
  const r = await runSsh(remote, remoteGitArgs(repoRoot, ['checkout', '-b', name]), opts)
  return toGitResult(r.code, r.stdout, r.stderr)
}

export async function remoteCheckoutBranch(
  remote: RemoteHost,
  repoRoot: string,
  name: string,
  opts?: SshOptions
): Promise<GitResult> {
  const r = await runSsh(remote, remoteGitArgs(repoRoot, ['checkout', name]), opts)
  return toGitResult(r.code, r.stdout, r.stderr)
}

/** Parse `git log --pretty=format:%h%x09%an%x09%ad%x09%s` output (shared with
 * the live op). Pure so it is unit-testable without ssh. */
export function parseRemoteCommits(stdout: string): GitCommitInfo[] {
  const commits: GitCommitInfo[] = []
  for (const line of stdout.split('\n')) {
    if (!line) continue
    const [hash, author, date, subject] = line.split('\t')
    if (!hash) continue
    commits.push({ hash, author: author ?? '', date: date ?? '', subject: subject ?? '' })
  }
  return commits
}

export async function remoteRecentCommits(
  remote: RemoteHost,
  repoRoot: string,
  limit = 20,
  opts?: SshOptions
): Promise<GitCommitInfo[]> {
  const r = await runSsh(
    remote,
    remoteGitArgs(repoRoot, ['log', `-${limit}`, '--pretty=format:%h%x09%an%x09%ad%x09%s', '--date=short']),
    opts
  )
  return r.code === 0 ? parseRemoteCommits(r.stdout) : []
}

export async function remotePush(
  remote: RemoteHost,
  repoRoot: string,
  opts?: SshOptions
): Promise<GitResult> {
  const r = await runSsh(remote, remoteGitArgs(repoRoot, ['push']), opts)
  return toGitResult(r.code, r.stdout, r.stderr)
}

export async function remotePull(
  remote: RemoteHost,
  repoRoot: string,
  opts?: SshOptions
): Promise<GitResult> {
  const r = await runSsh(remote, remoteGitArgs(repoRoot, ['pull']), opts)
  return toGitResult(r.code, r.stdout, r.stderr)
}

/** Push the current branch and set its upstream (publish to the remote). */
export async function remotePublish(
  remote: RemoteHost,
  repoRoot: string,
  opts?: SshOptions
): Promise<GitResult> {
  const branch = await remoteCurrentBranch(remote, repoRoot, opts)
  const r = await runSsh(remote, remoteGitArgs(repoRoot, ['push', '-u', 'origin', branch]), opts)
  return toGitResult(r.code, r.stdout, r.stderr)
}

/** Staged diff text (what the next commit would include). Empty when nothing is staged. */
export async function remoteStagedDiff(
  remote: RemoteHost,
  repoRoot: string,
  opts?: SshOptions
): Promise<string> {
  const r = await runSsh(remote, remoteGitArgs(repoRoot, ['diff', '--cached']), opts)
  return r.code === 0 ? r.stdout : ''
}

/** `git show <ref>:<path>` content over ssh, or null when the ref lacks the path. */
export async function remoteShowFromRef(
  remote: RemoteHost,
  repoRoot: string,
  ref: string,
  path: string,
  opts?: SshOptions
): Promise<string | null> {
  const arg = ref === ':' ? `:${path}` : `${ref}:${path}`
  const r = await runSsh(remote, remoteGitArgs(repoRoot, ['show', arg]), opts)
  return r.code === 0 ? r.stdout : null
}
