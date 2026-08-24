// Termsprawl Cloud — main-process runtime for the in-app sign-in + backup.
// Wraps the core (Electron-free) CloudClient with the Electron bits: the
// system browser open (device flow) and the workspace snapshot for backups.
// The renderer never sees the GitHub token or the session cookie.
import { shell } from 'electron'
import { CloudClient, CloudError } from '../core/cloud'
import type { CloudBackup, CloudDevicePoll, CloudDeviceStart, CloudUser, WorkspaceSnapshot } from '../shared/types'

export interface CloudRuntimeOptions {
  /** Cloud origin, e.g. https://termsprawl.com (the client appends /api/v1/...). */
  apiBase: string
  /** Inject for tests. Defaults to the global fetch. */
  fetchFn?: typeof fetch
  /** Returns the current workspace; used to build the backup payload. */
  snapshot: () => WorkspaceSnapshot
}

export interface CloudRuntime {
  getUser: () => Promise<CloudUser | null>
  /** Start device flow + open the verification page in the browser. */
  deviceStart: () => Promise<CloudDeviceStart>
  devicePoll: (deviceCode: string) => Promise<CloudDevicePoll>
  signOut: () => Promise<void>
  backupNow: () => Promise<CloudBackup>
  listBackups: (limit?: number) => Promise<CloudBackup[]>
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function createCloudRuntime(opts: CloudRuntimeOptions): CloudRuntime {
  // The session cookie is held here, in the main process. The renderer sandbox
  // never reads it; every cloud request to /api/v1/* is credentialed with it.
  let cookie: string | null = null
  const client = new CloudClient({
    apiBase: opts.apiBase,
    fetchFn: opts.fetchFn ?? globalThis.fetch,
    keepCookie: (c) => {
      cookie = c || null
    },
    getCookie: () => cookie,
  })

  async function getUser(): Promise<CloudUser | null> {
    try {
      return await client.me()
    } catch (e) {
      if (CloudClient.isUnauthorized(e)) return null
      throw e
    }
  }

  async function deviceStart(): Promise<CloudDeviceStart> {
    const start = await client.deviceStart()
    // Open the page where the user enters the code (GitHub /login/device in prod).
    void shell.openExternal(start.verification_uri)
    return start
  }

  async function devicePoll(deviceCode: string): Promise<CloudDevicePoll> {
    return client.devicePoll(deviceCode)
  }

  async function signOut(): Promise<void> {
    await client.signOut()
  }

  async function backupNow(): Promise<CloudBackup> {
    // Best-effort: source the payload from the current workspace.
    const snap = opts.snapshot()
    const proj = snap.index.projects.find((x) => !x.closed && !x.archived) ?? snap.index.projects[0]
    const nodes = (proj && snap.projects[proj.id]) || []
    const at = new Date().toISOString()
    return client.createBackup({
      project: proj ? proj.cwd || proj.name : 'termsprawl',
      name: 'auto',
      workspace: { id: proj?.id ?? null, at, nodes },
      files: { nodes: nodes as unknown[] },
    })
  }

  async function listBackups(limit?: number): Promise<CloudBackup[]> {
    return client.listBackups(limit)
  }

  return { getUser, deviceStart, devicePoll, signOut, backupNow, listBackups }
}

export { CloudError }
