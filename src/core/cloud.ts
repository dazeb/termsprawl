// Phase — Termsprawl Cloud client (Electron-free).
// Pure engine: the actual I/O (fetch + cookie store) is injected, so it is
// unit-testable here and the Server Edition can boot the same engine. The
// Electron main process supplies the real fetch + an in-memory cookie store
// (see src/main/cloud.ts). Shapes mirror termsprawl-web/docs/cloud-app-integration.md.
import type {
  CloudBackup,
  CloudBackupDetail,
  CloudDevicePoll,
  CloudDeviceStart,
  CloudSpace,
  CloudSpaceAccess,
  CloudSyncStatus,
  CloudUser,
} from '../shared/types'

export interface CloudClientConfig {
  /** The cloud origin, e.g. https://termsprawl.com (no trailing slash). The client appends /api/v1/... */
  apiBase: string
  fetchFn: typeof fetch
  /** Persist the session cookie (from the Set-Cookie header). */
  keepCookie: (cookie: string) => void
  /** Read the current session cookie. */
  getCookie: () => string | null
}

export interface CloudBackupPayload {
  project: string
  name?: string
  workspace: unknown
  files: Record<string, unknown>
}

export class CloudError extends Error {
  code: string
  status: number
  constructor(status: number, code: string, message: string) {
    super(message)
    this.code = code
    this.status = status
  }
}

function isAuthError(e: unknown): e is { status: number } {
  return typeof e === 'object' && e !== null && typeof (e as { status?: unknown }).status === 'number'
}

export class CloudClient {
  private cfg: CloudClientConfig

  constructor(cfg: CloudClientConfig) {
    this.cfg = cfg
  }

  /** URL the main process opens in the system browser to start GitHub OAuth. */
  oauthStartUrl(): string {
    return `${this.cfg.apiBase}/api/v1/auth/github`
  }

  /** Exchange a GitHub OAuth code for a session cookie. */
  async exchangeCode(code: string): Promise<void> {
    await this.request<void>('/api/v1/auth/github', { method: 'POST', body: JSON.stringify({ code }) })
  }

  async signOut(): Promise<void> {
    await this.request<void>('/api/v1/auth/logout', { method: 'POST' })
    this.cfg.keepCookie('')
  }

  /** Start GitHub Device Flow; the caller shows user_code + verification_uri. */
  async deviceStart(): Promise<CloudDeviceStart> {
    return this.request<CloudDeviceStart>('/api/v1/auth/device', { method: 'POST' })
  }

  /** Poll the device flow; pending until the user approves in the browser. */
  async devicePoll(deviceCode: string): Promise<CloudDevicePoll> {
    return this.request<CloudDevicePoll>('/api/v1/auth/device/poll', { method: 'POST', body: JSON.stringify({ device_code: deviceCode }) })
  }

  async me(): Promise<CloudUser> {
    return this.request<CloudUser>('/api/v1/me')
  }

  async syncStatus(): Promise<CloudSyncStatus> {
    return this.request<CloudSyncStatus>('/api/v1/sync/status')
  }

  async listBackups(limit = 20): Promise<CloudBackup[]> {
    return this.request<CloudBackup[]>(`/api/v1/backups?limit=${limit}`)
  }

  async createBackup(payload: CloudBackupPayload): Promise<CloudBackup> {
    return this.request<CloudBackup>('/api/v1/backups', { method: 'POST', body: JSON.stringify(payload) })
  }

  async getBackup(id: string): Promise<CloudBackupDetail> {
    return this.request<CloudBackupDetail>(`/api/v1/backups/${id}`)
  }

  /** The signed-in user's online canvas space, or null when none exists yet. */
  async getSpace(): Promise<CloudSpace | null> {
    const res = await this.request<{ space: CloudSpace | null }>('/api/v1/spaces/mine')
    return res.space
  }

  /** Provision (or return) the user's space. Free plans get 403 upgrade_required. */
  async provisionSpace(): Promise<CloudSpace> {
    return this.request<CloudSpace>('/api/v1/spaces', { method: 'POST' })
  }

  /** Mint a short-lived (~5 min) access token for the browser hand-off. */
  async spaceAccessToken(): Promise<CloudSpaceAccess> {
    return this.request<CloudSpaceAccess>('/api/v1/spaces/access', { method: 'POST' })
  }

  /** True when the supplied error means the user is not signed in (401). */
  static isUnauthorized(e: unknown): boolean {
    return isAuthError(e) && e.status === 401
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const cookie = this.cfg.getCookie()
    const res = await this.cfg.fetchFn(`${this.cfg.apiBase}${path}`, {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
        ...init.headers,
      },
      ...init,
    })
    const sc = res.headers.get('set-cookie')
    if (sc) this.cfg.keepCookie(sc.split(';')[0])
    if (!res.ok) {
      let code = 'unknown'
      let message = `Request failed (${res.status})`
      try {
        const body = (await res.json()) as { error?: { code?: string; message?: string } }
        code = body?.error?.code ?? code
        message = body?.error?.message ?? message
      } catch {
        // non-JSON error body — keep defaults
      }
      throw new CloudError(res.status, code, message)
    }
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  }
}

/** Build the URL the system browser opens: the space URL from the API response
 * with the short-lived access token appended as `?t=<token>` — the param the
 * space-router validates. Malformed URLs come back untouched (the openExternal
 * handler drops non-http(s) anyway); the base never comes from us. */
export function spaceOpenUrl(spaceUrl: string, token: string): string {
  try {
    const u = new URL(spaceUrl)
    u.searchParams.set('t', token)
    return u.toString()
  } catch {
    return spaceUrl
  }
}
