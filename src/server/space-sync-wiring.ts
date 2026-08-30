// Space-sync wiring for the Server Edition — the bridge between the live
// workspace (RPC surface) and the Electron-free sync engine (core/space-sync).
// Pure orchestration with injected call helpers, so tests drive it without a
// listener or a cloud. The entry block in index.ts passes thin wrappers.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadProjectFile } from '../core/workspace-files'
import { pullLatest, pushSnapshot, type PushResult, type SpaceSnapshotPayload, type SpaceSyncConfig } from '../core/space-sync'
import { IPC } from '../shared/ipc'
import type { SerializedNode } from '../shared/types'

const SCROLLBACK_DIR = 'terminal-scrollback'
const MAX_SCROLLBACK_BYTES = 256 * 1024 // mirror core/scrollback-store.ts's cap

export interface WorkspaceSnapshotLike {
  index: {
    projects: Array<{
      id: string
      name: string
      cwd: string | null
      closed?: boolean
      archived?: boolean
      [key: string]: unknown
    }>
  }
  projects: Record<string, SerializedNode[]>
  currentProjectId?: string
}

export interface SyncWiringDeps {
  cfg: SpaceSyncConfig
  userDataPath: string
  /** RPC wrapper (mirrors the entry block's callResult helper). */
  call: (method: string, args: unknown[]) => Promise<unknown>
  log?: (...parts: unknown[]) => void
}

/** Build the snapshot payload from LIVE state: full workspace blob (index +
 * per-project nodes + revs from the project files), folder-project file
 * contents, and every terminal node's byte-capped scrollback. */
export async function buildSnapshotPayload(deps: SyncWiringDeps): Promise<SpaceSnapshotPayload> {
  const snap = (await deps.call('workspace:snapshot', [])) as WorkspaceSnapshotLike
  const revs: Record<string, number> = {}
  for (const project of snap.index.projects) {
    // Snapshot projects carry optional flags; loadProjectFile only reads
    // id/name/cwd to locate the file — normalize to a full ProjectMeta.
    const meta = { closed: false, archived: false, ...project } as typeof project & { closed: boolean; archived: boolean }
    revs[project.id] = loadProjectFile(deps.userDataPath, meta)?.rev ?? 0
  }
  // Folder projects keep their file under <cwd>/.termsprawl/project.json —
  // carry the raw contents so a desktop clone can adopt them verbatim.
  const files: Record<string, unknown> = {}
  for (const project of snap.index.projects) {
    if (project.cwd) {
      const p = join(project.cwd, '.termsprawl', 'project.json')
      if (existsSync(p)) {
        try {
          files[`${project.cwd}/.termsprawl/project.json`] = JSON.parse(readFileSync(p, 'utf8'))
        } catch {
          // unreadable project file — skip it, the nodes blob still carries state
        }
      }
    }
  }
  const scrollbacks: Record<string, string> = {}
  const dir = join(deps.userDataPath, SCROLLBACK_DIR)
  if (existsSync(dir)) {
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith('.txt')) continue
      try {
        let text = readFileSync(join(dir, entry), 'utf8')
        if (text.length > MAX_SCROLLBACK_BYTES) text = text.slice(text.length - MAX_SCROLLBACK_BYTES)
        scrollbacks[entry.replace(/\.txt$/, '')] = text
      } catch {
        // raced a delete — skip
      }
    }
  }
  return { workspace: { ...snap, revs }, files, scrollbacks }
}

/** Boot restore: pull the latest snapshot and apply newer-rev projects.
 * Returns what happened; NEVER throws (offline-first boot). */
export async function restoreFromCloud(
  deps: SyncWiringDeps
): Promise<{ restored: boolean; reason?: string; projectsApplied?: number }> {
  let payload: SpaceSnapshotPayload | null
  try {
    payload = await pullLatest(deps.cfg)
  } catch (error) {
    deps.log?.(`[space-sync] boot restore failed (continuing offline):`, error instanceof Error ? error.message : error)
    return { restored: false, reason: 'pull-failed' }
  }
  if (!payload) return { restored: false, reason: 'no-snapshot' }

  const blob = payload.workspace as (WorkspaceSnapshotLike & { revs?: Record<string, number> }) | undefined
  if (!blob?.index || !blob.projects) {
    deps.log?.('[space-sync] boot restore skipped: malformed snapshot')
    return { restored: false, reason: 'malformed' }
  }

  let applied = 0
  const localRevs: Record<string, number> = {}
  // First pass: local revs for comparison (before any writes bump them).
  for (const project of blob.index.projects) {
    const meta = { closed: false, archived: false, ...project } as typeof project & { closed: boolean; archived: boolean }
    localRevs[project.id] = loadProjectFile(deps.userDataPath, meta)?.rev ?? -1
  }
  for (const project of blob.index.projects) {
    const incoming = blob.revs?.[project.id]
    const nodes = blob.projects[project.id]
    if (!Array.isArray(nodes)) continue
    // Rev rule: apply only when the snapshot is strictly newer than local
    // (missing revs count as older — a rev-less snapshot never clobbers).
    if (typeof incoming !== 'number' || incoming <= (localRevs[project.id] ?? -1)) continue
    if (!blob.index.projects.some((p) => p.id === project.id)) continue
    // The project may not exist locally yet — import it WITH the snapshot's
    // id (project:add would mint a new id and saveNodes below would target a
    // project that doesn't exist). Existing id → skip the import; saveNodes
    // applies the snapshot onto the known project.
    const exists = await deps.call('workspace:snapshot', [])
    const known = (exists as { index?: { projects?: Array<{ id: string }> } } | undefined)?.index?.projects
    if (Array.isArray(known) && !known.some((p) => p.id === project.id)) {
      await deps.call(IPC.projectImport, [project.id, project.name ?? project.id, project.cwd ?? null])
    }
    await deps.call('workspace:save-nodes', [project.id, nodes])
    applied++
  }

  // Terminal scrollback history rides along (byte-capped, same layout the
  // ScrollbackStore uses: <userData>/terminal-scrollback/<nodeId>.txt).
  const dir = join(deps.userDataPath, SCROLLBACK_DIR)
  mkdirSync(dir, { recursive: true })
  for (const [nodeId, text] of Object.entries(payload.scrollbacks ?? {})) {
    if (typeof text !== 'string') continue
    try {
      writeFileSync(join(dir, `${nodeId}.txt`), text.slice(0, MAX_SCROLLBACK_BYTES), 'utf8')
    } catch {
      // best-effort
    }
  }

  deps.log?.(`[space-sync] boot restore applied ${applied} project(s)`)
  return { restored: applied > 0 || Object.keys(payload.scrollbacks ?? {}).length > 0, projectsApplied: applied }
}

/** A coalescing push handle bound to the live workspace. markDirty() from the
 * auto-save timer; flush() on shutdown. Pushes never throw. */
export function createSpacePusher(
  deps: SyncWiringDeps,
  opts: { minIntervalMs?: number } = {}
): { markDirty: () => void; flush: () => Promise<PushResult | null> } {
  let dirty = false
  let inFlight: Promise<PushResult> | null = null

  const push = async (): Promise<PushResult> => {
    try {
      const payload = await buildSnapshotPayload(deps)
      return await pushSnapshot(deps.cfg, payload)
    } catch (error) {
      // Payload build (fs/RPC) failures collapse into the PushResult too —
      // the auto-save path must never see a rejection.
      return { ok: false, retryable: true, error: error instanceof Error ? error.message : String(error) }
    }
  }

  const pump = async (): Promise<PushResult | null> => {
    if (inFlight) return inFlight
    if (!dirty) return null
    dirty = false
    inFlight = push()
      .then((result) => {
        if (result.ok) deps.log?.(`[space-sync] push ok (${result.bytes} bytes)`)
        else deps.log?.(`[space-sync] push failed (retryable=${result.retryable}): ${result.error}`)
        return result
      })
      .finally(() => {
        inFlight = null
        if (dirty) void pump() // chain the coalesced follow-up
      })
    return inFlight
  }

  return {
    markDirty: () => {
      dirty = true
      void pump()
    },
    flush: async () => {
      // Await an in-flight push (markDirty's self-pump may already be running
      // — flush must not report null while work is racing); capture its
      // result, then force anything still dirty. Pushes never reject.
      let result: PushResult | null = null
      if (inFlight) {
        result = await inFlight.catch(() => null)
      }
      if (dirty) {
        dirty = false
        result = await push()
      }
      return result
    },
  }
}
