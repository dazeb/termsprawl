// Node link service (Phase 18): main-process wiring that turns persisted
// NodeLink records into live engine runs. Owns the auto-run scheduler, PTY
// activity taps, and the resolver that maps link endpoints to nodes, project
// roots, and fs paths. Operates across ALL projects (a background terminal's
// auto-link keeps running when its tab is not active). Electron-free except
// for the final IPC registration in main/index.ts (all deps injected).
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises'
import type { NodeLink } from '@shared/types'
import { runLink, stagedContextPath, type LinkEngineDeps } from '../../core/links/engine'
import { extractContent } from '../../core/links/registry'
import { LinkScheduler } from './scheduler'

export interface LinkServiceDeps {
  /** All persisted links (store.allLinks). */
  allLinks(): NodeLink[]
  /** Locate one link by id (store.findLink). */
  findLink(linkId: string): { link: NodeLink; projectId: string } | null
  /** The project that owns a node (null when unknown). */
  projectOfNode(nodeId: string): { id: string; cwd: string | null } | null
  /** Live PTY pane capture; null when the session is gone. */
  capturePane(nodeId: string): string | null
  /** Write into a live PTY (no-op when the session is gone). */
  ptyWrite(nodeId: string, data: string): void
  /** Push a chat event to the renderer (commit rides the ChatNode). */
  chatBroadcast(nodeId: string, event: unknown): void
  /** The workspace's serialized nodes per project (for extraction). */
  nodesOfProject(projectId: string): Array<Record<string, unknown>>
  /** Save link lastRun status back (best-effort; never throws). */
  recordLinkRun(projectId: string, linkId: string, at: number, ok: boolean, summary: string): void
  /** Send text to a configured A2A peer (real client, wired in main). */
  sendToPeer(
    peerId: string,
    text: string,
    opts: { deliverReply: boolean; sourceNodeId?: string }
  ): Promise<{ reply?: string }>
  /** userData dir — cwd-less projects write link outputs under it. */
  userDataPath: string
}

/** Resolve a link output path under a root; throws OUTSIDE on escape. */
function resolveOutputPath(projectRoot: string, relPath: string): string {
  const root = resolve(projectRoot)
  const full = isAbsolute(relPath) ? resolve(relPath) : resolve(root, relPath)
  if (full !== root && !full.startsWith(root + sep)) {
    throw new Error('OUTSIDE')
  }
  return full
}

export class LinkService {
  private scheduler: LinkScheduler

  constructor(private readonly deps: LinkServiceDeps) {
    this.scheduler = new LinkScheduler(async (linkId) => {
      await this.runById(linkId)
    })
    this.scheduler.setLinks(this.deps.allLinks())
  }

  /** Sync the scheduler after a link edit (any project). */
  linksChanged(): void {
    this.scheduler.setLinks(this.deps.allLinks())
  }

  /** PTY activity for a terminal/agent node → schedule its auto links. */
  notePtyActivity(nodeId: string): void {
    this.scheduler.markDirty(nodeId)
  }

  /** Renderer dirty signal (sticky/chat/editor content changed). */
  markDirty(sourceId: string): void {
    this.scheduler.markDirty(sourceId)
  }

  /** Run one link by id (manual "Run now" or the scheduler). */
  async runById(linkId: string): Promise<{ ok: boolean; summary: string }> {
    const found = this.deps.findLink(linkId)
    if (!found) return { ok: false, summary: 'link not found' }
    return this.runLink(found.link, found.projectId)
  }

  /** Extract content from a source node by id. */
  private async extractByNode(nodeId: string, projectId: string) {
    const nodes = this.deps.nodesOfProject(projectId)
    const node = nodes.find((n) => n.id === nodeId) as
      | { id: string; type?: string; data?: Record<string, unknown> }
      | undefined
    if (!node) return { kind: 'empty' as const }
    return extractContent(
      { nodeId, nodeKind: String(node.type ?? node.data?.kind ?? ''), data: node.data ?? {} },
      {
        capturePane: async (id) => this.deps.capturePane(id),
        readFile: async (path) => {
          try {
            return await readFile(path, 'utf8')
          } catch {
            return null
          }
        }
      }
    )
  }

  /** Run one link end to end. Never throws. */
  async runLink(link: NodeLink, projectId: string): Promise<{ ok: boolean; summary: string }> {
    const project = this.deps.projectOfNode(link.source) ?? this.deps.projectOfNode(link.target)
    // Folder projects root link outputs at the project folder; cwd-less
    // (inline/remote) projects get a per-project dir under userData.
    const projectRoot = project?.cwd ?? join(this.deps.userDataPath, 'link-outputs', projectId)
    const source = await this.extractByNode(link.source, projectId)
    const nodes = this.deps.nodesOfProject(projectId)
    const targetNode = nodes.find((n) => n.id === link.target) as
      | { id: string; type?: string; data?: Record<string, unknown> }
      | undefined
    const targetKind =
      link.kind === 'a2a-peer' ? 'a2a-peer' : String(targetNode?.type ?? targetNode?.data?.kind ?? 'file')

    const deps: LinkEngineDeps = {
      writeFile: async (path, content) => {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, content, 'utf8')
      },
      appendFile: async (path, content) => {
        await mkdir(dirname(path), { recursive: true })
        await appendFile(path, content, 'utf8')
      },
      mkdirp: async (path) => {
        await mkdir(path, { recursive: true })
      },
      resolveOutputPath: (root, rel) => resolveOutputPath(root, rel),
      chatInject: async (nodeId, message, sourceTitle) => {
        this.deps.chatBroadcast(nodeId, {
          kind: 'context-added',
          messageId: `ctx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          role: message.role,
          content: message.content,
          sourceTitle
        })
      },
      ptyWrite: async (nodeId, data) => {
        this.deps.ptyWrite(nodeId, data)
      },
      a2aSend: async (peerId, text, opts) => {
        return this.deps.sendToPeer(peerId, text, { ...opts, sourceNodeId: link.source })
      }
    }

    const result = await runLink(
      link,
      {
        source,
        targetKind,
        targetData: (targetNode?.data ?? {}) as Record<string, unknown>,
        projectRoot
      },
      deps
    )
    this.deps.recordLinkRun(projectId, link.id, Date.now(), result.ok, result.summary)
    return result
  }

  /** The staged context path for a terminal target (for tests / CLI docs). */
  stagedPathFor(targetNodeId: string): string {
    return stagedContextPath(targetNodeId)
  }

  /** One-shot send: extract a node's content and forward it to a peer. */
  async sendNodeToPeer(nodeId: string, peerId: string): Promise<{ ok: boolean; summary: string }> {
    const project = this.deps.projectOfNode(nodeId)
    if (!project) return { ok: false, summary: 'node not found' }
    const source = await this.extractByNode(nodeId, project.id)
    if (source.kind === 'empty') return { ok: false, summary: 'source is empty' }
    try {
      const res = await this.deps.sendToPeer(peerId, source.text, { deliverReply: false, sourceNodeId: nodeId })
      const reply = res.reply ? ` — reply: ${res.reply.slice(0, 120)}` : ''
      return { ok: true, summary: `sent to peer ${peerId}${reply}` }
    } catch (err) {
      return { ok: false, summary: `send failed: ${err instanceof Error ? err.message : String(err)}` }
    }
  }

  dispose(): void {
    this.scheduler.dispose()
  }
}
