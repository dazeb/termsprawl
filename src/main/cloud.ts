// Termsprawl Cloud — main-process runtime for the in-app sign-in + backup.
// Wraps the core (Electron-free) CloudClient with the Electron bits: the
// system browser open (device flow) and the workspace snapshot for backups.
// The renderer never sees the GitHub token or the session cookie.
//
// While signed in, a background poller watches sync/status and auto-fulfils a
// web-dashboard "Back up now" request (backup_requested_at) by running
// backupNow() — the honest end-to-end path, since the web never holds the
// workspace content itself.
import { shell } from 'electron'
import { CloudClient, CloudError, spaceOpenUrl } from '../core/cloud'
import type { CloudBackup, CloudDevicePoll, CloudDeviceStart, CloudSpace, CloudUser, WorkspaceSnapshot } from '../shared/types'
import type { SpaceSnapshotPayload } from '../core/space-sync'

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
  /** The signed-in user's online canvas space (null when none provisioned). */
  getSpace: () => Promise<CloudSpace | null>
  /** Provision (or return) the user's space — free plans surface 403. */
  provisionSpace: () => Promise<CloudSpace>
  /** Pull the latest space snapshot (null when the space has none yet). */
  pullSpace: () => Promise<SpaceSnapshotPayload | null>
  /** Push a snapshot payload to the user's space; resolves { ok, bytes }. */
  pushSpace: (payload: SpaceSnapshotPayload) => Promise<{ ok: true; bytes: number }>
  /** Mint a short-lived space access token and open the canvas URL with it
   * in the system browser (Pro-gated server-side; free users get 403). */
  openSpace: () => Promise<void>
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const POLL_INTERVAL_MS = 30_000

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

  let backupPoller: ReturnType<typeof setInterval> | null = null
  let backupPolling = false

  async function getUser(): Promise<CloudUser | null> {
    try {
      const user = await client.me()
      if (user) startBackupPolling()
      return user
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
    const poll = await client.devicePoll(deviceCode)
    if (poll.status === 'ok') startBackupPolling()
    return poll
  }

  async function signOut(): Promise<void> {
    stopBackupPolling()
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

  async function getSpace(): Promise<CloudSpace | null> {
    return client.getSpace()
  }

  function provisionSpace(): Promise<CloudSpace> {
    return client.provisionSpace()
  }

  async function pullSpace(): Promise<SpaceSnapshotPayload | null> {
    return client.pullSpaceContent()
  }

  async function pushSpace(payload: SpaceSnapshotPayload): Promise<{ ok: true; bytes: number }> {
    return client.pushSpaceContent(payload)
  }

  async function openSpace(): Promise<void> {
    // Token minted lazily, right before the open — it lives ~5 minutes.
    const access = await client.spaceAccessToken()
    void shell.openExternal(spaceOpenUrl(access.url, access.token))
  }

  // Fulfil a "Back up now" requested from the web dashboard. The web raises
  // backup_requested_at via POST /api/v1/sync/now; the app (which owns the
  // workspace content) sees it here, runs a real backup, and the server clears
  // the flag when the new backup lands.
  async function maybeRunPendingBackup(): Promise<void> {
    if (backupPolling) return
    backupPolling = true
    try {
      const st = await client.syncStatus()
      const pending = !!st.backup_requested_at && (!st.last_backup_at || st.backup_requested_at > st.last_backup_at)
      if (pending) await backupNow()
    } catch {
      // Transient network / auth errors — the next poll retries.
    } finally {
      backupPolling = false
    }
  }

  function startBackupPolling(): void {
    if (backupPoller) return
    backupPoller = setInterval(() => void maybeRunPendingBackup(), POLL_INTERVAL_MS)
  }

  function stopBackupPolling(): void {
    if (backupPoller) {
      clearInterval(backupPoller)
      backupPoller = null
    }
  }

  return { getUser, deviceStart, devicePoll, signOut, backupNow, listBackups, getSpace, provisionSpace, pullSpace, pushSpace, openSpace }
}

export { CloudError }
