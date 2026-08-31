// Workspace bundle — the ENTIRE workspace as ONE json file: index + every
// project's nodes + terminal scrollback. The body is exactly the spaces-sync
// envelope (SpaceSnapshotPayload) so file export, cloud sync, and the space
// boot path all speak one format. Pure + DI (no electron, no fs) — callers
// supply index/nodes/revs/scrollback readers; main and the store do the I/O.
// See .hermes/plans/2026-08-30_123805-workspace-bundle.md.
//
// Import invariant (v0.14.0 review): node ids are LOAD-BEARING — the pty
// session id == tmux key == scrollback file == persisted id. applyBundlePlan
// therefore remaps terminal ids whenever they collide with ids already in use
// locally (and remaps scrollback keys in lockstep). Non-terminal ids are
// not load-bearing and are kept.
import type { SnapshotWorkspace } from './space-snapshots'
import type { SerializedNode } from './workspace-files'

export const BUNDLE_FORMAT = 'termsprawl-workspace'
export const BUNDLE_VERSION = 1

export interface WorkspaceBundle {
  bundle: { format: typeof BUNDLE_FORMAT; version: number; savedAt: string }
  workspace: SnapshotWorkspace
  files: Record<string, unknown>
  scrollbacks: Record<string, string>
}

/** Read-side view of the live workspace the caller assembles (from the store
 * index, project files, and the scrollback store). */
export interface BundleSourceDeps {
  index: SnapshotWorkspace['index']
  /** Serialized nodes for one project id (empty array when absent). */
  nodesFor: (projectId: string) => SerializedNode[]
  /** Persisted rev for one project id (0 when absent). Revs are REQUIRED in
   * a bundle — restore paths skip rev-less projects as "older". */
  revFor: (projectId: string) => number
  /** Capped scrollback text for the given terminal-node ids. */
  scrollbacksFor: (nodeIds: readonly string[]) => Record<string, string>
  currentProjectId?: string
  now?: () => Date
}

/** The import plan applyBundlePlan computes: everything the caller needs to
 * land the bundle as NEW local projects — without touching any store itself. */
export interface BundleImportPlan {
  projects: Array<{
    id: string
    name: string
    cwd: null
    /** SerializedNode[] with terminal ids possibly remapped. */
    nodes: SerializedNode[]
    /** The bundle's rev for this project (import paths re-save to bump it). */
    rev: number
  }>
  /** terminalId → scrollback text, keyed by the POST-remap ids; hand to
   * ScrollbackStore.importSnapshot AFTER the projects land. */
  pendingScrollbacks: Map<string, string>
}

/** Collect terminal-node ids from serialized nodes (type === 'terminal'),
 * order-stable, skipping nodes without usable ids. */
export function terminalIdsIn(nodes: ReadonlyArray<SerializedNode>): string[] {
  return nodes
    .filter((n) => (n as { type?: string }).type === 'terminal')
    .map((n) => String((n as { id?: unknown }).id ?? ''))
    .filter((id) => id.length > 0)
}

/** Build the single-file bundle from live state. */
export function buildBundle(deps: BundleSourceDeps): WorkspaceBundle {
  const projects: Record<string, SerializedNode[]> = {}
  const revs: Record<string, number> = {}
  const allTerminalIds: string[] = []
  for (const meta of deps.index.projects) {
    const nodes = deps.nodesFor(meta.id) ?? []
    projects[meta.id] = nodes
    revs[meta.id] = deps.revFor(meta.id)
    allTerminalIds.push(...terminalIdsIn(nodes))
  }
  return {
    bundle: {
      format: BUNDLE_FORMAT,
      version: BUNDLE_VERSION,
      savedAt: (deps.now ?? (() => new Date()))().toISOString(),
    },
    workspace: {
      index: deps.index,
      projects,
      revs,
      ...(deps.currentProjectId ? { currentProjectId: deps.currentProjectId } : {}),
    },
    files: {},
    scrollbacks: deps.scrollbacksFor(allTerminalIds),
  }
}

/** Structural validation: header format + supported version + the envelope
 * actually contains an index with projects and a matching projects map.
 * Never throws — callers hand it arbitrary parsed json. */
export function isValidBundle(value: unknown): value is WorkspaceBundle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const b = value as Partial<WorkspaceBundle>
  if (!b.bundle || typeof b.bundle !== 'object') return false
  if (b.bundle.format !== BUNDLE_FORMAT) return false
  if (typeof b.bundle.version !== 'number' || b.bundle.version !== BUNDLE_VERSION) return false
  const ws = b.workspace
  if (!ws || typeof ws !== 'object' || !ws.index || !Array.isArray(ws.index.projects)) return false
  if (!ws.projects || typeof ws.projects !== 'object') return false
  // Every index project must have a (possibly empty) nodes entry — a missing
  // key means a truncated/corrupt bundle.
  return ws.index.projects.every((p) => Array.isArray(ws.projects[p.id]))
}

/** The shared '<base> 2', '<base> 3'… collision scheme used by project
 * naming across import paths. */
export function uniqueNameWithSuffix(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base} ${n}`)) n += 1
  return `${base} ${n}`
}

/** Compute the import plan for a parsed bundle. Pure: returns fresh project
 * ids/names, remapped nodes, and remapped scrollback text — the caller then
 * creates projects (workspace:import/add), saves nodes, and feeds
 * pendingScrollbacks to ScrollbackStore.importSnapshot.
 *
 * Id semantics (plan D1): terminal ids are remapped ONLY when they collide
 * with ids already in use locally (existingTerminalIds). When any terminal id
 * collides, ALL terminals of the import are remapped — mixing kept and fresh
 * identities across machines is how duplicate-tmux-key bugs happen. */
export function applyBundlePlan(
  bundle: WorkspaceBundle,
  opts: {
    existingNames: readonly string[]
    existingTerminalIds: ReadonlySet<string>
    newProjectId: () => string
    newTerminalId: (ordinal: number) => string
  }
): BundleImportPlan {
  if (!isValidBundle(bundle)) throw new Error('Invalid workspace bundle (bad format, unsupported version, or truncated)')
  const index = bundle.workspace.index
  if (index.projects.length === 0) throw new Error('The workspace bundle has no projects to import')

  const takenNames = new Set(opts.existingNames)
  const plan: BundleImportPlan = { projects: [], pendingScrollbacks: new Map() }

  // Two passes: decide per-project remapping first (any collision → remap
  // all terminals of that project), then emit nodes + scrollback text.
  for (const meta of index.projects) {
    const nodes = bundle.workspace.projects[meta.id] ?? []
    const termIds = terminalIdsIn(nodes)
    const collides = termIds.some((id) => opts.existingTerminalIds.has(id))

    const idMap = new Map<string, string>()
    if (collides) {
      let ordinal = 0
      for (const id of termIds) idMap.set(id, opts.newTerminalId(++ordinal))
    }

    const remappedNodes = nodes.map((node) => {
      if (idMap.size === 0) return node
      const id = (node as { id?: unknown }).id
      const fresh = typeof id === 'string' ? idMap.get(id) : undefined
      return fresh ? ({ ...node, id: fresh } as SerializedNode) : node
    })

    const freshId = opts.newProjectId()
    const name = uniqueNameWithSuffix(String(meta.name ?? freshId).trim() || freshId, takenNames)
    takenNames.add(name)

    plan.projects.push({
      id: freshId,
      name,
      cwd: null, // the bundle's cwd belonged to another machine
      nodes: remappedNodes,
      rev: bundle.workspace.revs?.[meta.id] ?? 0,
    })

    for (const id of termIds) {
      const text = bundle.scrollbacks?.[id]
      if (typeof text !== 'string') continue
      plan.pendingScrollbacks.set(idMap.get(id) ?? id, text)
    }
  }
  return plan
}
