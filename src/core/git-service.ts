// Git service for the diff node — electron-free, system git via execFile.
// Written fresh for termsprawl (clean-room): argv-array spawns only, never a
// shell string. The Server Edition can boot this same core.

import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative } from 'node:path'

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
