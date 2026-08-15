import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { diffInfo, findRepoRoot, readWorkingTree, showFromRef } from './git-service'

// Each test gets a throwaway git repo under the OS temp dir; removed after.
let repoRoot: string
let nestedDir: string

function git(args: string[], cwd: string): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' })
}

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'termsprawl-git-'))
  repoRoot = join(base, 'repo')
  mkdirSync(repoRoot)
  git(['init', '-q', '-b', 'main'], repoRoot)
  git(['config', 'user.email', 'test@example.com'], repoRoot)
  git(['config', 'user.name', 'Test'], repoRoot)
  writeFileSync(join(repoRoot, 'file.txt'), 'v1 line\n')
  git(['add', 'file.txt'], repoRoot)
  git(['commit', '-q', '-m', 'init'], repoRoot)
  // A nested dir to prove repo-root discovery walks up.
  nestedDir = join(repoRoot, 'src', 'deep')
  mkdirSync(nestedDir, { recursive: true })
})

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true })
})

describe('findRepoRoot', () => {
  it('walks up from a nested directory to the repo root', () => {
    expect(findRepoRoot(nestedDir)).toBe(repoRoot)
  })

  it('returns the repo root itself when called from the root', () => {
    expect(findRepoRoot(repoRoot)).toBe(repoRoot)
  })

  it('returns null outside a repository', () => {
    const loose = mkdtempSync(join(tmpdir(), 'termsprawl-notrepo-'))
    try {
      expect(findRepoRoot(join(loose, 'a', 'b'))).toBeNull()
    } finally {
      rmSync(loose, { recursive: true, force: true })
    }
  })
})

describe('showFromRef', () => {
  it('returns committed content for HEAD', async () => {
    expect(await showFromRef(repoRoot, 'HEAD', 'file.txt')).toBe('v1 line\n')
  })

  it('returns staged (index) content for the :path ref', async () => {
    writeFileSync(join(repoRoot, 'file.txt'), 'staged line\n')
    git(['add', 'file.txt'], repoRoot)
    writeFileSync(join(repoRoot, 'file.txt'), 'working line\n') // unstaged change on top
    expect(await showFromRef(repoRoot, ':', 'file.txt')).toBe('staged line\n')
  })

  it('returns null when the path does not exist in the ref', async () => {
    expect(await showFromRef(repoRoot, 'HEAD', 'missing.txt')).toBeNull()
  })
})

describe('readWorkingTree', () => {
  it('reads the current on-disk content', () => {
    writeFileSync(join(repoRoot, 'file.txt'), 'uncommitted edit\n')
    expect(readWorkingTree(repoRoot, 'file.txt')).toBe('uncommitted edit\n')
  })

  it('returns null for a missing file', () => {
    expect(readWorkingTree(repoRoot, 'nope.txt')).toBeNull()
  })
})

describe('diffInfo', () => {
  it('builds HEAD diff: original from ref, modified from working tree', async () => {
    writeFileSync(join(repoRoot, 'file.txt'), 'edited working copy\n')
    const info = await diffInfo(join(nestedDir, '..', '..', 'file.txt'), 'HEAD')
    expect(info.error).toBeUndefined()
    expect(info.original).toBe('v1 line\n')
    expect(info.modified).toBe('edited working copy\n')
  })

  it('reports NO_REPO when the path is outside a git repo', async () => {
    const loose = mkdtempSync(join(tmpdir(), 'termsprawl-norepo-'))
    try {
      const info = await diffInfo(join(loose, 'file.txt'), 'HEAD')
      expect(info.error?.code).toBe('NO_REPO')
    } finally {
      rmSync(loose, { recursive: true, force: true })
    }
  })

  it('reports no error with null original when ref lacks the path (untracked)', async () => {
    writeFileSync(join(repoRoot, 'new.txt'), 'untracked\n')
    const info = await diffInfo(join(repoRoot, 'new.txt'), 'HEAD')
    expect(info.error).toBeUndefined()
    expect(info.original).toBeNull()
    expect(info.modified).toBe('untracked\n')
  })
})
