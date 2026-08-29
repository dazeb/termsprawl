// Space snapshot sync — the Electron-free engine behind "online canvas
// spaces": each hosted space pushes canvas snapshots (workspace + project
// files + terminal scrollback) to the Termsprawl Cloud API and pulls them on
// boot. Pure DI like core/cloud.ts: fetch + clock are injected, nothing here
// touches the filesystem or spawns processes. B3 wires this into the Server
// Edition's boot and auto-save timer.
import type { CloudError } from './cloud'

export interface SpaceSyncConfig {
  /** Cloud origin, e.g. https://termsprawl.com (no trailing slash). */
  apiBase: string
  /** This space's boot token — also its push/pull bearer credential. */
  bootToken: string
  fetchFn: typeof fetch
  /** Injectable clock (ms epoch) for interval decisions in tests. */
  now?: () => number
}

export interface SpaceSnapshotPayload {
  /** Serialized workspace/nodes blob (shape of core/workspace-files.ts). */
  workspace: unknown
  /** Project file path → its JSON content. */
  files: Record<string, unknown>
  /** Terminal node id → captured scrollback text. */
  scrollbacks: Record<string, string>
}

export type PushResult = { ok: true; bytes: number } | { ok: false; retryable: boolean; error: string }

/** Mirrors CloudError's shape (status + code + message) without importing it
 * at runtime — core modules share types, not instances. */
export class SpaceSyncError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export type SpaceSyncErrorLike = CloudError | SpaceSyncError

const CONTENT_PATH = '/api/v1/space/content'

function authHeaders(cfg: SpaceSyncConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${cfg.bootToken}`,
    'Content-Type': 'application/json',
  }
}

function serialize(payload: SpaceSnapshotPayload): string {
  return JSON.stringify(payload)
}

/** Parse `{ error: { code, message } }` bodies; fall back to the status. */
async function errorFromBody(res: Response): Promise<{ code: string; message: string }> {
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } }
    return {
      code: body?.error?.code ?? 'unknown',
      message: body?.error?.message ?? `Request failed (${res.status})`,
    }
  } catch {
    return { code: 'unknown', message: `Request failed (${res.status})` }
  }
}

/** Push a snapshot. NEVER throws — the auto-save path calls this blindly, so
 * every failure mode collapses into a PushResult (retryable flags 429/5xx/
 * network; a 4xx is a config problem no retry helps). */
export async function pushSnapshot(cfg: SpaceSyncConfig, payload: SpaceSnapshotPayload): Promise<PushResult> {
  const body = serialize(payload)
  try {
    const res = await cfg.fetchFn(`${cfg.apiBase}${CONTENT_PATH}`, {
      method: 'POST',
      headers: authHeaders(cfg),
      body,
    })
    if (res.ok) return { ok: true, bytes: new TextEncoder().encode(body).length }
    const err = await errorFromBody(res)
    const retryable = res.status === 429 || res.status >= 500
    return { ok: false, retryable, error: err.message }
  } catch (error) {
    return { ok: false, retryable: true, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Fetch the latest snapshot; null when the space has none yet (404). Other
 * failures throw — the boot path decides whether to continue offline. */
export async function pullLatest(cfg: SpaceSyncConfig): Promise<SpaceSnapshotPayload | null> {
  let res: Response
  try {
    res = await cfg.fetchFn(`${cfg.apiBase}${CONTENT_PATH}`, {
      method: 'GET',
      headers: authHeaders(cfg),
    })
  } catch (error) {
    throw new SpaceSyncError(0, 'network', error instanceof Error ? error.message : String(error))
  }
  if (res.status === 404) return null
  if (!res.ok) {
    const err = await errorFromBody(res)
    throw new SpaceSyncError(res.status, err.code, err.message)
  }
  return (await res.json()) as SpaceSnapshotPayload
}

export interface PushScheduler {
  /** Record that the canvas changed. Coalesces while a push is in flight. */
  markDirty: () => void
  /** Force any pending push now; resolves with its result (or null when
   * nothing was dirty / the last push is too recent). Never rejects. */
  flush: () => Promise<PushResult | null>
}

/** Coalescing push scheduler. The payload is pulled FRESH at push time via
 * `getPayload()` — the canvas keeps changing between markDirty and the actual
 * push, so serializing early would ship stale state. At most one push is in
 * flight; marks arriving mid-flight collapse into exactly one follow-up.
 * `minIntervalMs` debounces bursty timers (B3's 30s auto-save). No timers of
 * its own — cadence belongs to the caller. */
export function createPushScheduler(
  cfg: SpaceSyncConfig,
  opts: { getPayload: () => SpaceSnapshotPayload; minIntervalMs?: number }
): PushScheduler {
  const now = cfg.now ?? (() => Date.now())
  const minInterval = opts.minIntervalMs ?? 0
  let dirty = false
  let inFlight: Promise<PushResult> | null = null
  let lastPushAt = -Infinity

  const runPush = async (): Promise<PushResult> => {
    lastPushAt = now()
    return pushSnapshot(cfg, opts.getPayload())
  }

  const pump = async (): Promise<PushResult | null> => {
    if (inFlight) return inFlight
    if (!dirty) return null
    if (now() - lastPushAt < minInterval) return null
    dirty = false
    inFlight = runPush().finally(() => {
      inFlight = null
      // Chain the coalesced follow-up: marks that arrived mid-flight must
      // produce exactly ONE more push once this one lands (the documented
      // invariant), not wait for the caller's next pump trigger.
      if (dirty) void pump()
    })
    return inFlight
  }

  const markDirty = (): void => {
    dirty = true
    // Fire-and-forget coalescing: marks never block the caller. The chained
    // pump keeps the "one follow-up max" invariant without timers.
    void pump()
  }

  const flush = async (): Promise<PushResult | null> => {
    // Wait out the in-flight push first, then a possibly-scheduled follow-up,
    // then honor the caller's explicit flush even inside the debounce window.
    let result: PushResult | null = null
    // One in-flight push may chain one follow-up; two rounds cover that.
    for (let round = 0; round < 2; round++) {
      if (inFlight) {
        result = await inFlight.catch(() => null)
      }
      if (dirty) {
        dirty = false
        result = await runPush()
      }
    }
    return result
  }

  return { markDirty, flush }
}
