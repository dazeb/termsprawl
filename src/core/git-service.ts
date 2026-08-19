// Git service for the diff node — electron-free, system git via execFile.
// Written fresh for termsprawl (clean-room): argv-array spawns only, never a
// shell string. The Server Edition can boot this same core.

import { execFile, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative } from 'node:path'
import type {
  GitBranchInfo,
  GitCommitInfo,
  GitFileChange,
  GitFileStatus,
  GitResult,
  GitSyncState
} from '../shared/types'

export type DiffErrorCode = 'NO_REPO' | 'MISSING' | 'IO'

export interface DiffInfo {
  /** Content from the git ref (staged index or HEAD); null if the ref has no such path. */
  original: string | null
  /** Current working-tree content; null if the file can't be read. */
  modified: string | null
  error?: { code: DiffErrorCode; message: string }
}

export type DiffBase = 'staged' | 'HEAD'

/**
 * Walk up from `startDir` looking for a `.git` directory. Returns the first
 * directory that contains one, or null when no repository encloses the path.
 */
export function findRepoRoot(startDir: string): string | null {
  let dir = startDir
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/**
 * `git show <ref>:<path>` content, or null when the path doesn't exist in
 * that ref. `ref` is the git ref argument: `HEAD:path` form is handled by the
 * caller passing `HEAD` — this function builds `<ref>:<path>` itself. Staged
 * content is `:path` (the index), i.e. pass `ref=':'`.
 */
export function showFromRef(repoRoot: string, ref: string, path: string): Promise<string | null> {
  return new Promise((resolve) => {
    const arg = ref === ':' ? `:${path}` : `${ref}:${path}`
    execFile(
      'git',
      ['show', arg],
      { cwd: repoRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          // git show exits non-zero when the path is missing from the ref.
          resolve(null)
          return
        }
        resolve(stdout)
      }
    )
  })
}

/**
 * Read the working-tree file relative to the repo root. Returns null when the
 * file is missing or unreadable.
 */
export function readWorkingTree(repoRoot: string, path: string): string | null {
  try {
    return readFileSync(join(repoRoot, path), 'utf8')
  } catch {
    return null
  }
}

/** Path passed in may be relative to the repo root or absolute — resolve both
 * to the repo-relative form git expects. */
function resolveRepoPath(repoRoot: string, path: string): string {
  return isAbsolute(path) ? relative(repoRoot, path) : path
}

/**
 * Build the diff payload for a file: original from the chosen ref (staged
 * index or HEAD), modified from the working tree. Never throws — errors are
 * returned in the payload so the renderer can show a status line.
 */
export async function diffInfo(path: string, base: DiffBase): Promise<DiffInfo> {
  const repoRoot = findRepoRoot(dirname(path))
  if (!repoRoot) {
    return {
      original: null,
      modified: null,
      error: { code: 'NO_REPO', message: 'not a git repository' }
    }
  }

  const repoPath = resolveRepoPath(repoRoot, path)
  const ref = base === 'staged' ? ':' : 'HEAD'
  const original = await showFromRef(repoRoot, ref, repoPath)
  const modified = readWorkingTree(repoRoot, repoPath)

  if (original === null && modified === null) {
    return {
      original: null,
      modified: null,
      error: { code: 'IO', message: 'path is missing from the ref and the working tree' }
    }
  }

  return { original, modified }
}

// ---------------------------------------------------------------------------
// Source control ops (Phase 8, Task 8.1). System git via argv-array execFile
// (never a shell string). Remote-agnostic — works with github, gitea, or any
// origin. Electron-free so the Server Edition boots the same core.
// ---------------------------------------------------------------------------

import { execFile as execFileCb } from 'node:child_process'

function runGit(cwd: string, args: string[]): Promise<GitResult> {
  return new Promise((resolve) => {
    execFileCb(
      'git',
      ['-c', 'color.ui=false', ...args],
      { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const code = err ? ((err as NodeJS.ErrnoException & { code?: number }).code ?? 1) : 0
        resolve({ code, stdout: String(stdout), stderr: String(stderr) })
      }
    )
  })
}

export type {
  GitFileStatus,
  GitFileChange,
  GitBranchInfo,
  GitCommitInfo,
  GitSyncState,
  GitResult
} from '../shared/types'

/** Parse `git status --porcelain` (v1) into a change list. Each line is
 * `XY <path>`; X is the index (staged) state, Y the working-tree state. */
export function parseGitStatus(porcelain: string): GitFileChange[] {
  const changes: GitFileChange[] = []
  for (const line of porcelain.split('\n')) {
    if (line.length < 3) continue
    const x = line[0]!
    const y = line[1]!
    const path = line.slice(3)
    if (x === '?' && y === '?') {
      changes.push({ path, status: 'untracked', staged: false })
      continue
    }
    const staged = x !== ' ' && x !== '?'
    const src = staged ? x : y
    let status: GitFileStatus = 'modified'
    if (src === 'A') status = 'added'
    else if (src === 'D') status = 'deleted'
    else if (src === 'R') status = 'renamed'
    changes.push({ path, status, staged })
  }
  return changes
}

export async function gitStatus(repoRoot: string): Promise<GitFileChange[]> {
  const res = await runGit(repoRoot, ['status', '--porcelain'])
  return res.code === 0 ? parseGitStatus(res.stdout) : []
}

export async function currentBranch(repoRoot: string): Promise<string> {
  const res = await runGit(repoRoot, ['branch', '--show-current'])
  return res.code === 0 ? res.stdout.trim() : ''
}

export async function listBranches(repoRoot: string): Promise<GitBranchInfo[]> {
  const res = await runGit(repoRoot, ['branch', '--format=%(HEAD)%09%(refname:short)'])
  if (res.code !== 0) return []
  const branches: GitBranchInfo[] = []
  for (const line of res.stdout.split('\n')) {
    if (!line) continue
    const tab = line.indexOf('\t')
    if (tab === -1) continue
    branches.push({ name: line.slice(tab + 1), current: line[0] === '*' })
  }
  return branches
}

export async function stageChanges(repoRoot: string, paths: string[]): Promise<GitResult> {
  return runGit(repoRoot, ['add', '-A', '--', ...paths])
}

export async function unstageChanges(repoRoot: string, paths: string[]): Promise<GitResult> {
  return runGit(repoRoot, ['restore', '--staged', '--', ...paths])
}

/** Restore working-tree files to HEAD, discarding uncommitted edits. Destructive. */
export async function discardChanges(repoRoot: string, paths: string[]): Promise<GitResult> {
  return runGit(repoRoot, ['checkout', '--', ...paths])
}

export async function createBranch(repoRoot: string, name: string): Promise<GitResult> {
  return runGit(repoRoot, ['checkout', '-b', name])
}

export async function checkoutBranch(repoRoot: string, name: string): Promise<GitResult> {
  return runGit(repoRoot, ['checkout', name])
}

export async function deleteBranch(repoRoot: string, name: string): Promise<GitResult> {
  return runGit(repoRoot, ['branch', '-D', name])
}

export async function commitChanges(repoRoot: string, message: string): Promise<GitResult> {
  return runGit(repoRoot, ['commit', '-m', message])
}

export async function recentCommits(repoRoot: string, limit = 20): Promise<GitCommitInfo[]> {
  const res = await runGit(repoRoot, [
    'log',
    `-${limit}`,
    '--pretty=format:%h%x09%an%x09%ad%x09%s',
    '--date=short'
  ])
  if (res.code !== 0) return []
  const commits: GitCommitInfo[] = []
  for (const line of res.stdout.split('\n')) {
    if (!line) continue
    const [hash, author, date, subject] = line.split('\t')
    if (!hash) continue
    commits.push({ hash, author: author ?? '', date: date ?? '', subject: subject ?? '' })
  }
  return commits
}

/** Parse `## main...origin/main [ahead N, behind M]` from `git status -sb`. */
export function parseSyncState(branchLine: string): GitSyncState {
  const m = /^##\s+([^.\s]+)(?:\.\.\.(\S+))?(?:\s+\[ahead\s+(\d+)(?:,\s+behind\s+(\d+))?\])?/.exec(
    branchLine.trim()
  )
  if (!m) return { upstream: null, ahead: 0, behind: 0 }
  return {
    upstream: m[2] ? m[2] : null,
    ahead: Number(m[3] ?? 0),
    behind: Number(m[4] ?? 0)
  }
}

export async function syncState(repoRoot: string): Promise<GitSyncState> {
  const res = await runGit(repoRoot, ['status', '-sb', '--porcelain=1'])
  if (res.code !== 0) return { upstream: null, ahead: 0, behind: 0 }
  const first = res.stdout.split('\n')[0] ?? ''
  return parseSyncState(first)
}

export async function push(repoRoot: string): Promise<GitResult> {
  return runGit(repoRoot, ['push'])
}

export async function pull(repoRoot: string): Promise<GitResult> {
  return runGit(repoRoot, ['pull'])
}

/** Push the current branch and set its upstream (publish to the remote). */
export async function publish(repoRoot: string): Promise<GitResult> {
  const branch = await currentBranch(repoRoot)
  return runGit(repoRoot, ['push', '-u', 'origin', branch])
}

export async function remoteUrl(repoRoot: string, name = 'origin'): Promise<string | null> {
  const res = await runGit(repoRoot, ['remote', 'get-url', name])
  return res.code === 0 ? res.stdout.trim() : null
}

export async function ghAuthed(): Promise<boolean> {
  const res = spawnSync('gh', ['auth', 'status'], { stdio: 'ignore' })
  return res.status === 0
}
