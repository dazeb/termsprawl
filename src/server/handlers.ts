// Server Edition RPC handlers — map IPC channel names to the same electron-free
// core services the desktop main process uses. Constructed once at boot; the
// ws layer in index.ts hands messages to the dispatcher built from these.
//
// v1 scope: projects + terminals + boot reads (app/settings/updates/
// announcements). File list/read are provided for the file tree. git, managed
// accounts, cloud writes, and agent hooks are intentionally unimplemented here
// (the panel/feature code rejects gracefully).

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { WorkspaceStore } from '../core/workspace-store'
import { PtyManager } from '../core/pty-manager'
import { loadAppSettings, saveAppSettings } from '../core/app-settings'
import { idleUpdateStatus } from '../shared/update-status'
import { IPC } from '../shared/ipc'
import { diffInfo } from '../core/git-service'
import {
  findRepoRoot, currentBranch, remoteUrl, syncState, gitStatus,
  listBranches, recentCommits, ghAuthed, stageChanges, unstageChanges,
  discardChanges, commitChanges, createBranch, checkoutBranch,
  push as gitPush, pull as gitPull, publish as gitPublish,
  listWorktrees, addWorktree, removeWorktree
} from '../core/git-service'
import { generateCommitMessage } from '../core/commit-message'
import type { RpcHandler } from './rpc'
import type { CorePlatform } from '../core/platform'
import type {
  AppSettings, DirEntry, DirListResult, FileReadResult, FileWriteResult,
  ProjectRemote, ProjectSettings, PtyCreateRequest, SerializedNode,
  GitPanelSnapshot, GitResult, GitTarget, DiffBase, DiffInfoResult,
  CommitMessageResult, GitWorktree
} from '../shared/types'

/** Version of the app served. Read from package.json at boot, fallback if absent. */
function readVersion(): string {
  try {
    return JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version
  } catch {
    return '0.0.0'
  }
}

/** Resolve a leaf path under root, guarding against traversal outside root. */
function safeResolve(root: string, rel?: string): string {
  const base = resolve(root)
  const target = resolve(base, rel ?? '')
  if (target !== base && !target.startsWith(`${base}${sep}`)) throw new Error('path outside root')
  return target
}

export function buildHandlers(platform: CorePlatform): Record<string, RpcHandler> {
  const version = readVersion()
  const workspaceStore = new WorkspaceStore(platform)
  const ptyManager = new PtyManager(platform)
  const userDataPath = platform.userDataPath
  mkdirSync(userDataPath, { recursive: true })

  return {
    [IPC.appVersion]: () => version,

    [IPC.appSettingsGet]: () => loadAppSettings(userDataPath),
    [IPC.appSettingsSet]: (args) => saveAppSettings(userDataPath, (args[0] ?? {}) as Partial<AppSettings>),

    [IPC.updateCheck]: () => idleUpdateStatus(),
    [IPC.updateDownload]: () => idleUpdateStatus(),
    [IPC.updateInstall]: () => idleUpdateStatus(),
    [IPC.updateDismiss]: () => idleUpdateStatus(),
    [IPC.announcementGet]: () => null,

    [IPC.workspaceSnapshot]: () => workspaceStore.snapshot(),
    [IPC.workspaceSaveNodes]: (args): number => {
      const [id, nodes] = args
      return workspaceStore.saveNodes(String(id), nodes as SerializedNode[])
    },
    [IPC.projectAdd]: (args) => {
      const [name, cwd, remote] = args
      if (cwd) {
        const existing = workspaceStore.snapshot().index.projects.find((p) => p.cwd === cwd)
        if (existing) return existing
      }
      return workspaceStore.addProject(String(name), (cwd as string | null) ?? null, remote as ProjectRemote | undefined)
    },
    [IPC.projectClose]: (args) => workspaceStore.closeProject(String(args[0])),
    [IPC.projectArchive]: (args) => workspaceStore.archiveProject(String(args[0])),
    [IPC.projectReopen]: (args) => workspaceStore.reopenProject(String(args[0])),
    [IPC.projectDelete]: (args) => workspaceStore.deleteProject(String(args[0])),
    [IPC.projectUpdateSettings]: (args) =>
      workspaceStore.updateSettings(String(args[0]), args[1] as ProjectSettings),
    [IPC.projectRename]: (args) => workspaceStore.renameProject(String(args[0]), String(args[1])),

    [IPC.ptyCreate]: (args): ReturnType<PtyManager['create']> => ptyManager.create(args[0] as PtyCreateRequest),
    [IPC.ptyWrite]: (args): null => {
      ptyManager.write(String(args[0]), String(args[1]))
      return null
    },
    [IPC.ptyResize]: (args): null => {
      ptyManager.resize(String(args[0]), Number(args[1]), Number(args[2]))
      return null
    },
    [IPC.ptyDestroy]: (args): null => {
      ptyManager.destroy(String(args[0]))
      return null
    },
    [IPC.terminalClose]: (args) => {
      ptyManager.destroy(String(args[1]))
      return { committed: true as const, cleanupPendingIds: [] }
    },
    [IPC.ptyReadScrollback]: (args): string | null => ptyManager.readScrollback(String(args[0])),

    [IPC.fileList]: (args): DirListResult => {
      const [root, rel] = args
      try {
        const dir = safeResolve(String(root), rel as string | undefined)
        if (!existsSync(dir)) return { error: { code: 'MISSING', message: 'no such directory' } }
        const entries: DirEntry[] = readdirSync(dir, { withFileTypes: true }).map((d) => ({
          name: d.name,
          path: join(dir, d.name),
          kind: d.isDirectory() ? 'dir' : 'file'
        }))
        return { entries }
      } catch (error) {
        return { error: { code: 'IO', message: String(error) } }
      }
    },
    [IPC.fileRead]: (args): FileReadResult => {
      const [path] = args
      try {
        const content = readFileSync(String(path), 'utf8')
        return { kind: 'text', content }
      } catch (error) {
        return { error: { code: 'MISSING', message: String(error) } }
      }
    },
    [IPC.fileWrite]: (args): FileWriteResult => {
      const [path, content] = args
      try {
        mkdirSync(dirname(String(path)), { recursive: true })
        writeFileSync(String(path), String(content), 'utf8')
        return { ok: true }
      } catch (error) {
        return { error: { code: 'IO', message: String(error) } }
      }
    },

    // -- Source control (git) + diff -------------------------------------------

    [IPC.diffInfo]: (args): Promise<DiffInfoResult> => {
      const [path, base] = args
      return diffInfo(String(path), (base as DiffBase | undefined) ?? 'HEAD') as Promise<DiffInfoResult>
    },

    [IPC.gitSnapshot]: async (args): Promise<GitPanelSnapshot> => {
      const [target] = args as [GitTarget]
      const cwd = target?.cwd ?? ''
      if (!cwd || !existsSync(cwd)) {
        return {
          cwd: cwd || null, branch: '', remote: null,
          sync: { upstream: null, ahead: 0, behind: 0 },
          changes: [], branches: [], commits: [], ghAuthed: false
        }
      }
      const root = findRepoRoot(cwd)
      if (!root) {
        return {
          cwd, branch: '', remote: null,
          sync: { upstream: null, ahead: 0, behind: 0 },
          changes: [], branches: [], commits: [], ghAuthed: false
        }
      }
      const [branch, remote, sync, changes, branches, commits, authed] = await Promise.all([
        currentBranch(root),
        remoteUrl(root),
        syncState(root),
        gitStatus(root),
        listBranches(root),
        recentCommits(root, 20),
        ghAuthed()
      ])
      return { cwd, branch, remote, sync, changes, branches, commits, ghAuthed: authed }
    },

    [IPC.gitStage]: (args): Promise<GitResult> => {
      const [target, paths] = args as [GitTarget, string[]]
      const root = resolveRepoRoot(target)
      if (!root) return Promise.resolve({ code: 1, stdout: '', stderr: 'no project folder' })
      return stageChanges(root, paths)
    },

    [IPC.gitUnstage]: (args): Promise<GitResult> => {
      const [target, paths] = args as [GitTarget, string[]]
      const root = resolveRepoRoot(target)
      if (!root) return Promise.resolve({ code: 1, stdout: '', stderr: 'no project folder' })
      return unstageChanges(root, paths)
    },

    [IPC.gitDiscard]: (args): Promise<GitResult> => {
      const [target, paths] = args as [GitTarget, string[]]
      const root = resolveRepoRoot(target)
      if (!root) return Promise.resolve({ code: 1, stdout: '', stderr: 'no project folder' })
      return discardChanges(root, paths)
    },

    [IPC.gitCommit]: (args): Promise<GitResult> => {
      const [target, message] = args as [GitTarget, string]
      const root = resolveRepoRoot(target)
      if (!root) return Promise.resolve({ code: 1, stdout: '', stderr: 'no project folder' })
      return commitChanges(root, message)
    },

    [IPC.gitCommitMessage]: (args): Promise<CommitMessageResult> => {
      const [target] = args as [GitTarget]
      const root = resolveRepoRoot(target)
      if (!root) return Promise.resolve({ ok: false, error: 'no project folder' })
      return generateCommitMessage(root)
    },

    [IPC.gitCreateBranch]: (args): Promise<GitResult> => {
      const [target, name] = args as [GitTarget, string]
      const root = resolveRepoRoot(target)
      if (!root) return Promise.resolve({ code: 1, stdout: '', stderr: 'no project folder' })
      return createBranch(root, name)
    },

    [IPC.gitCheckout]: (args): Promise<GitResult> => {
      const [target, name] = args as [GitTarget, string]
      const root = resolveRepoRoot(target)
      if (!root) return Promise.resolve({ code: 1, stdout: '', stderr: 'no project folder' })
      return checkoutBranch(root, name)
    },

    [IPC.gitPush]: (args): Promise<GitResult> => {
      const [target] = args as [GitTarget]
      const root = resolveRepoRoot(target)
      if (!root) return Promise.resolve({ code: 1, stdout: '', stderr: 'no project folder' })
      return gitPush(root)
    },

    [IPC.gitPull]: (args): Promise<GitResult> => {
      const [target] = args as [GitTarget]
      const root = resolveRepoRoot(target)
      if (!root) return Promise.resolve({ code: 1, stdout: '', stderr: 'no project folder' })
      return gitPull(root)
    },

    [IPC.gitPublish]: (args): Promise<GitResult> => {
      const [target] = args as [GitTarget]
      const root = resolveRepoRoot(target)
      if (!root) return Promise.resolve({ code: 1, stdout: '', stderr: 'no project folder' })
      return gitPublish(root)
    },

    [IPC.gitWorktrees]: (args): Promise<GitWorktree[]> => {
      const [target] = args as [GitTarget]
      const root = resolveRepoRoot(target)
      if (!root) return Promise.resolve([])
      return listWorktrees(root)
    },

    [IPC.gitWorktreeAdd]: (args): Promise<GitResult> => {
      const [target, path, branch] = args as [GitTarget, string, string | undefined]
      const root = resolveRepoRoot(target)
      if (!root) return Promise.resolve({ code: 1, stdout: '', stderr: 'no project folder' })
      return addWorktree(root, path, branch)
    },

    [IPC.gitWorktreeRemove]: (args): Promise<GitResult> => {
      const [target, worktreePath, force] = args as [GitTarget, string, boolean | undefined]
      const root = resolveRepoRoot(target)
      if (!root) return Promise.resolve({ code: 1, stdout: '', stderr: 'no project folder' })
      return removeWorktree(root, worktreePath, force ?? false)
    }
  }
}

/** Resolve a GitTarget to a local repo root, or null when there's no folder or repo. */
function resolveRepoRoot(target: GitTarget | undefined | null): string | null {
  const cwd = target?.cwd
  if (!cwd || !existsSync(cwd)) return null
  return findRepoRoot(cwd)
}
