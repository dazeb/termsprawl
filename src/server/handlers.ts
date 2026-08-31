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
import { createChatRuntime, type ChatSendRequest } from '../core/chat/runtime'
import { projectChatTools } from '../core/chat/project-tools'
import { resolveGitScope, resolveFileScope, resolvePtyScope } from '../core/project-scope'
import { importGitHubRepo } from '../core/github-import'
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

// ---------------------------------------------------------------------------
// Secret redaction (audit B1/B2): settings leaving this process must never
// carry key material. The renderer gets `hasKey` flags; writes go back through
// app:settings-set with the full values (the renderer read them from the user
// in the first place). Desktop main shares this shape via its own settings.get.
// ---------------------------------------------------------------------------
/** A settings shape where secrets are replaced by hasKey flags (what crosses
 * the boundary to any renderer). */
export type RedactedProviderKey = { providerId: string; hasKey: boolean }

export function redactSettings(settings: AppSettings): {
  chat?: Omit<NonNullable<AppSettings['chat']>, 'keys'> & { keys?: RedactedProviderKey[] }
  telegram?: Omit<NonNullable<AppSettings['telegram']>, 'token'> & { token?: undefined }
} & Omit<AppSettings, 'chat' | 'telegram'> {
  // Work on a structural clone typed as the UNREDACTED shape; the function's
  // return type is the REDACTED shape (hasKey flags, no token).
  type Unredacted = {
    chat?: { keys?: Array<{ providerId: string; key?: string }> } & Record<string, unknown>
    telegram?: { token?: string } & Record<string, unknown>
  } & Omit<AppSettings, 'chat' | 'telegram'>
  const out = JSON.parse(JSON.stringify(settings)) as unknown as Unredacted
  if (out.chat?.keys) {
    ;(out.chat as { keys?: RedactedProviderKey[] }).keys = (out.chat.keys ?? []).map((k) => ({
      providerId: k.providerId,
      hasKey: typeof k.key === 'string' && k.key.length > 0
    }))
  }
  if (out.telegram?.token) {
    ;(out.telegram as { token?: string }).token = undefined
  }
  return out as {
    chat?: Omit<NonNullable<AppSettings['chat']>, 'keys'> & { keys?: RedactedProviderKey[] }
    telegram?: Omit<NonNullable<AppSettings['telegram']>, 'token'> & { token?: undefined }
  } & Omit<AppSettings, 'chat' | 'telegram'>
}

export function buildHandlers(platform: CorePlatform): Record<string, RpcHandler> {
  const version = readVersion()
  const workspaceStore = new WorkspaceStore(platform)
  const ptyManager = new PtyManager(platform)
  const userDataPath = platform.userDataPath
  mkdirSync(userDataPath, { recursive: true })

  /** Resolve a GitTarget to a local repo root — ONLY for known projects
   * (audit B1; desktop parity with resolveGitTarget in main/index.ts). */
  const resolveRepoRoot = (target: GitTarget | undefined | null): string | null => {
    const scope = resolveGitScope(workspaceStore, target)
    if (scope.kind !== 'local') return null
    return findRepoRoot(scope.cwd)
  }

  // Chat driver v2 (Phase 11 Task 11.4): same runtime shape as the desktop
  // main process — settings-resolved provider + key, events broadcast on the
  // per-node channel the shim subscribes to.
  const chatRuntime = createChatRuntime({
    resolveProvider: (req: ChatSendRequest) => {
      const settings = loadAppSettings(userDataPath)
      const chat = settings.chat
      const providers = settings.apiProviders ?? []
      const wanted = req.provider ?? chat?.defaultProvider ?? providers[0]?.id
      const provider = providers.find((p) => p.id === wanted || p.name === wanted)
      if (!provider) return null
      const envKey = process.env[`TERMSPRAWL_PROVIDER_KEY_${provider.id.toUpperCase()}`]
      const storedKey = chat?.keys?.find((k) => k.providerId === provider.id)?.key
      const apiKey = envKey || storedKey || ''
      if (!apiKey) return null
      const isAnthropic = /anthropic/i.test(provider.baseUrl) || /anthropic/i.test(provider.name)
      return {
        id: provider.id,
        baseUrl: provider.baseUrl,
        apiKey,
        api: isAnthropic ? 'anthropic' : 'openai',
        model: req.model ?? chat?.defaultModel
      }
    },
    broadcast: (nodeId: string, event: unknown) => platform.broadcast(`chat:event:${nodeId}`, event),
    // Audit B3: same project-scoped read-only tool set as desktop. Anchored
    // to the first open local project (the Server Edition's active project).
    toolsFor: (req: ChatSendRequest) => {
      const cwd = workspaceStore
        .snapshot()
        .index.projects.find((p) => !p.closed && p.cwd)?.cwd
      return cwd ? projectChatTools(workspaceStore, { cwd }) : []
    },
    log: (msg: string) => console.log(`[chat] ${msg}`)
  })

  return {
    [IPC.appVersion]: () => version,

    // -- Settings (redacted) --------------------------------------------------
    // Audit B1/B2: settings leaving this process never carry key material.
    // The renderer reads hasKey flags; writes go through app:settings-set.
    [IPC.appSettingsGet]: () => redactSettings(loadAppSettings(userDataPath)),
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
    // Snapshot restore: import a project WITH its original id so revs and
    // node files stay comparable across machines. Duplicate id → error.
    [IPC.projectImport]: (args) => {
      const [id, name, cwd] = args
      return workspaceStore.addProject(String(name ?? id), (cwd as string | null) ?? null, undefined, { id: String(id) })
    },
    [IPC.projectClose]: (args) => workspaceStore.closeProject(String(args[0])),
    [IPC.projectArchive]: (args) => workspaceStore.archiveProject(String(args[0])),
    [IPC.projectReopen]: (args) => workspaceStore.reopenProject(String(args[0])),
    [IPC.projectDelete]: (args) => workspaceStore.deleteProject(String(args[0])),
    [IPC.projectUpdateSettings]: (args) =>
      workspaceStore.updateSettings(String(args[0]), args[1] as ProjectSettings),
    [IPC.projectRename]: (args) => workspaceStore.renameProject(String(args[0]), String(args[1])),

    // GitHub repo import (Phase 17): the SPACE clones the repo (its volume,
    // its git) and it lands as a real project. Requires the space env
    // (TS_CLOUD_API + TS_SPACE_BOOT_TOKEN); the clone URL is brokered by the
    // cloud and never surfaces here. Errors come back as { ok:false, error }.
    [IPC.githubImport]: async (args) => {
      const fullName = String(args[0] ?? '')
      const cloudApi = process.env.TS_CLOUD_API
      const bootToken = process.env.TS_SPACE_BOOT_TOKEN
      if (!cloudApi || !bootToken) return { ok: false as const, error: 'space env missing' }
      const destRoot = join(platform.userDataPath, 'projects-src')
      try {
        mkdirSync(destRoot, { recursive: true })
        const imported = await importGitHubRepo({ cloudApi, bootToken }, { fullName, destRoot })
        // Project name = repo name; cwd = the fresh clone. If a project with
        // this cwd already exists (re-import race) addProject throws — surface
        // that as the error string.
        const project = workspaceStore.addProject(imported.name, imported.path)
        return { ok: true as const, project, path: imported.path, fullName: imported.fullName }
      } catch (error) {
        return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
      }
    },

    [IPC.ptyCreate]: (args): ReturnType<PtyManager['create']> | { ok: false; error: string } => {
      const req = args[0] as PtyCreateRequest
      // Audit B1: the server bridge must NOT grant command execution to a WS
      // client, and terminals may only spawn in known projects. (Desktop main
      // allows commands — its renderer is the trusted UI.)
      const scope = resolvePtyScope(workspaceStore, req as unknown as { cwd?: string | null; command?: string; remote?: unknown }, { allowCommands: false })
      if (!scope.ok) return { ok: false, error: scope.reason }
      return ptyManager.create(req)
    },
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
        // Audit B1: the root itself must be a known project folder.
        const scope = resolveFileScope(workspaceStore, dir)
        if (!scope.ok) return { error: { code: 'OUTSIDE', message: scope.reason } }
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
      const [path, hint] = args as [string, { cwd?: string; projectId?: string } | undefined]
      // Audit B1: reads are confined to known project folders. The renderer
      // sends {cwd, projectId} hints; without a hint the path must fall under
      // SOME known project (still confined, just more permissive).
      const scope = resolveFileScope(workspaceStore, String(path), hint)
      if (!scope.ok) return { error: { code: 'OUTSIDE', message: scope.reason } }
      try {
        const content = readFileSync(scope.path, 'utf8')
        return { kind: 'text', content }
      } catch (error) {
        return { error: { code: 'MISSING', message: String(error) } }
      }
    },
    [IPC.fileWrite]: (args): FileWriteResult => {
      const [path, content, hint] = args as [string, string, { cwd?: string; projectId?: string } | undefined]
      const scope = resolveFileScope(workspaceStore, String(path), hint)
      if (!scope.ok) return { error: { code: 'OUTSIDE', message: scope.reason } }
      try {
        mkdirSync(dirname(scope.path), { recursive: true })
        writeFileSync(scope.path, String(content), 'utf8')
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
      // Audit B1: only KNOWN projects (desktop parity with resolveGitTarget).
      const scope = resolveGitScope(workspaceStore, target)
      if (scope.kind === 'none' || scope.kind === 'remote') {
        // remote git over the server bridge is desktop-main territory; the
        // server returns an empty panel rather than executing anything.
        return {
          cwd: cwd || null, branch: '', remote: null,
          sync: { upstream: null, ahead: 0, behind: 0 },
          changes: [], branches: [], commits: [], ghAuthed: false
        }
      }
      const root = findRepoRoot(scope.cwd)
      if (!root) {
        return {
          cwd: scope.cwd, branch: '', remote: null,
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
    },

    // Chat driver v2 (Phase 11 Task 11.4). Events stream on the chat:event:<nodeId>
    // broadcast channel; these are the invoke side.
    [IPC.chatSend]: (args) => {
      const req = args[0] as ChatSendRequest
      if (!req || typeof req.nodeId !== 'string' || !Array.isArray(req.messages)) {
        return Promise.resolve({ ok: false, error: 'bad chat request' })
      }
      return chatRuntime.send(req)
    },
    [IPC.chatStop]: (args) => {
      const [nodeId] = args
      if (typeof nodeId === 'string') chatRuntime.stop(nodeId)
    },
    [IPC.chatApprove]: (args) => {
      const [nodeId, callId, decision] = args
      if (typeof nodeId === 'string' && typeof callId === 'string' && (decision === 'approve' || decision === 'deny')) {
        chatRuntime.approve(nodeId, callId, decision)
      }
    }
  }
}

