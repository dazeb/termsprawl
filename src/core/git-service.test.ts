import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { diffInfo, findRepoRoot, readWorkingTree, showFromRef, parseGitStatus, gitStatus, currentBranch, listBranches, stageChanges, unstageChanges, discardChanges, createBranch, checkoutBranch, deleteBranch, commitChanges, recentCommits, parseSyncState, syncState, remoteUrl, push, publish } from './git-service'

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

describe('parseGitStatus', () => {
  it('parses unstaged, staged, and untracked lines', () => {
    const changes = parseGitStatus(' M file.txt\nM  staged.txt\n?? new.txt\nA  added.txt\n D gone.txt\n')
    expect(changes).toEqual([
      { path: 'file.txt', status: 'modified', staged: false },
      { path: 'staged.txt', status: 'modified', staged: true },
      { path: 'new.txt', status: 'untracked', staged: false },
      { path: 'added.txt', status: 'added', staged: true },
      { path: 'gone.txt', status: 'deleted', staged: false }
    ])
  })

  it('returns [] for empty porcelain', () => {
    expect(parseGitStatus('')).toEqual([])
  })
})

describe('git status/stage cycle', () => {
  it('reports an unstaged edit and an untracked file', async () => {
    writeFileSync(join(repoRoot, 'file.txt'), 'edited\n')
    writeFileSync(join(repoRoot, 'new.txt'), 'untracked\n')
    const changes = await gitStatus(repoRoot)
    expect(changes).toContainEqual({ path: 'file.txt', status: 'modified', staged: false })
    expect(changes).toContainEqual({ path: 'new.txt', status: 'untracked', staged: false })
  })

  it('stages and unstages a change', async () => {
    writeFileSync(join(repoRoot, 'file.txt'), 'staged edit\n')
    await stageChanges(repoRoot, ['file.txt'])
    expect(await gitStatus(repoRoot)).toContainEqual({
      path: 'file.txt',
      status: 'modified',
      staged: true
    })
    await unstageChanges(repoRoot, ['file.txt'])
    expect(await gitStatus(repoRoot)).toContainEqual({
      path: 'file.txt',
      status: 'modified',
      staged: false
    })
  })

  it('discards a working-tree edit back to HEAD', async () => {
    writeFileSync(join(repoRoot, 'file.txt'), 'will be discarded\n')
    await discardChanges(repoRoot, ['file.txt'])
    expect(readFileSync(join(repoRoot, 'file.txt'), 'utf8')).toBe('v1 line\n')
  })
})

describe('branches', () => {
  it('reports the current branch and lists it', async () => {
    expect(await currentBranch(repoRoot)).toBe('main')
    expect(await listBranches(repoRoot)).toContainEqual({ name: 'main', current: true })
  })

  it('creates, checks out, and deletes a branch', async () => {
    await createBranch(repoRoot, 'feature/x')
    expect(await currentBranch(repoRoot)).toBe('feature/x')
    await checkoutBranch(repoRoot, 'main')
    expect(await currentBranch(repoRoot)).toBe('main')
    await deleteBranch(repoRoot, 'feature/x')
    const names = (await listBranches(repoRoot)).map((b) => b.name)
    expect(names).not.toContain('feature/x')
  })
})

describe('commit + recentCommits', () => {
  it('commits and lists the new commit first', async () => {
    writeFileSync(join(repoRoot, 'file.txt'), 'v2\n')
    await stageChanges(repoRoot, ['file.txt'])
    await commitChanges(repoRoot, 'second')
    const commits = await recentCommits(repoRoot, 5)
    expect(commits[0]?.subject).toBe('second')
    expect(commits[0]?.hash).toMatch(/^[0-9a-f]{7}$/)
    expect(commits[1]?.subject).toBe('init')
  })
})

describe('sync state + remotes', () => {
  it('parses ahead/behind from the status -sb header', () => {
    expect(parseSyncState('## main...origin/main [ahead 2, behind 1]')).toEqual({
      upstream: 'origin/main',
      ahead: 2,
      behind: 1
    })
    expect(parseSyncState('## main')).toEqual({ upstream: null, ahead: 0, behind: 0 })
    expect(parseSyncState('## main...origin/main [ahead 3]')).toEqual({
      upstream: 'origin/main',
      ahead: 3,
      behind: 0
    })
  })

  it('reports no upstream in a repo without a remote', async () => {
    expect(await remoteUrl(repoRoot)).toBeNull()
    expect((await syncState(repoRoot)).upstream).toBeNull()
  })

  it('push/publish fail cleanly (non-zero) with no remote', async () => {
    expect((await push(repoRoot)).code).not.toBe(0)
    expect((await publish(repoRoot)).code).not.toBe(0)
  })
})
