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
import type { RpcHandler } from './rpc'
import type { CorePlatform } from '../core/platform'
import type {
  AppSettings,
  DirEntry,
  DirListResult,
  FileReadResult,
  FileWriteResult,
  ProjectRemote,
  ProjectSettings,
  PtyCreateRequest,
  SerializedNode
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
    }
  }
}
