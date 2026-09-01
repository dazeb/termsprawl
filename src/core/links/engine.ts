// Node link engine (Phase 18) — runs one link: take extracted source content,
// apply the link kind's semantics, and inject into the target. Electron-free,
// zero fs/pty/network access of its own: every side effect rides injected deps,
// so tests are pure and the Server Edition can reuse this unchanged.
//
// Injectors:
// - file-output        → write/append a file inside the project root
// - context-inject     → chat node (wrapped user message) or agent terminal
//                        (staged context file + one-line bracketed-paste pointer)
// - a2a-peer           → forward the payload to a configured A2A peer

import type { LinkRunResult, NodeLink } from '@shared/types'
import { sanitizeTitle, type SourceContent } from './registry'

/** Cap for file-output content (decimal MB — matches the "truncated at 1MB" note). */
const MB = 1_000_000
/** Bracketed-paste escapes — terminals treat the wrapped text as a literal paste. */
const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'
const TRUNCATE_NOTE = '\n<!-- truncated at 1MB -->'

export interface LinkEngineDeps {
  writeFile(path: string, content: string): Promise<void>
  appendFile(path: string, content: string): Promise<void>
  mkdirp(path: string): Promise<void>
  /** Resolve + validate a link output path against the project root. Throws on escape. */
  resolveOutputPath(projectRoot: string, relPath: string): string
  /**
   * Context-inject → chat: append the message to the node's live transcript
   * and re-render. The conversation lives in renderer node data (React Flow is
   * the single source of truth), so this rides the chat event push channel —
   * one call, not a data write + a separate UI event.
   */
  chatInject(nodeId: string, message: { role: 'user'; content: string }, sourceTitle: string): Promise<void>
  /** Context-inject → agent terminal: write into the live PTY. */
  ptyWrite(nodeId: string, data: string): Promise<void>
  /**
   * a2a-peer: forward text to the configured peer. When deliverReply is set and
   * the peer answers, the CALLER is responsible for delivering `reply` into a
   * linked chat node or terminal (documented split — the engine stays pure).
   */
  a2aSend(peerId: string, text: string, opts: { deliverReply: boolean }): Promise<{ reply?: string }>
  /** Injectable clock for header stamps. */
  now?(): number
}

/** Default relative output path for a source title. */
export function defaultOutputPath(sourceTitle: string): string {
  return `.termsprawl/outputs/${sanitizeTitle(sourceTitle)}.md`
}

/** The staged context file for an agent-terminal target. */
export function stagedContextPath(targetNodeId: string): string {
  return `.termsprawl/links/context/${targetNodeId}.md`
}

function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return i === -1 ? '.' : path.slice(0, i)
}

/**
 * Run one link end to end. NEVER throws — every failure path returns
 * { ok: false, summary } so a broken link can never take the app down.
 */
export async function runLink(
  link: NodeLink,
  input: {
    source: SourceContent
    targetKind: string
    targetData: Record<string, unknown>
    projectRoot: string
  },
  deps: LinkEngineDeps
): Promise<LinkRunResult> {
  try {
    if (input.source.kind === 'empty') return { ok: false, summary: 'source is empty' }

    switch (link.kind) {
      case 'file-output': {
        const cfg = link.config
        if (cfg.kind !== 'file-output') return { ok: false, summary: 'unknown link kind' }
        let text = input.source.text
        let truncated = false
        if (text.length > MB) {
          text = text.slice(0, MB)
          truncated = true
        }
        const relPath = cfg.path.trim().length > 0 ? cfg.path : defaultOutputPath(input.source.title)
        let absPath: string
        try {
          absPath = deps.resolveOutputPath(input.projectRoot, relPath)
        } catch {
          return { ok: false, summary: 'output path escapes project root' }
        }
        let content = ''
        if (cfg.header) {
          const iso = new Date(deps.now?.() ?? Date.now()).toISOString()
          content += `<!-- termsprawl link ${link.id} @ ${iso} -->\n\n`
        }
        content += text
        if (cfg.mode === 'append') content += '\n'
        if (truncated) content += TRUNCATE_NOTE
        await deps.mkdirp(dirname(absPath))
        if (cfg.mode === 'append') {
          await deps.appendFile(absPath, content)
        } else {
          await deps.writeFile(absPath, content)
        }
        return { ok: true, summary: `wrote ${relPath}` }
      }

      case 'context-inject': {
        const cfg = link.config
        if (cfg.kind !== 'context-inject') return { ok: false, summary: 'unknown link kind' }
        if (input.targetKind === 'chat') {
          const content = cfg.wrapper ? `[context from ${input.source.title}]\n${input.source.text}` : input.source.text
          await deps.chatInject(link.target, { role: 'user', content }, input.source.title)
          return { ok: true, summary: `injected into chat ${link.target}` }
        }
        if (input.targetKind === 'terminal') {
          const relPath = stagedContextPath(link.target)
          let absPath: string
          try {
            absPath = deps.resolveOutputPath(input.projectRoot, relPath)
          } catch {
            return { ok: false, summary: 'output path escapes project root' }
          }
          await deps.mkdirp(dirname(absPath))
          await deps.writeFile(absPath, input.source.text)
          if (cfg.pastePointer) {
            const pointer = `[termsprawl] context staged: ${relPath} — run /termsprawl-context to read`
            await deps.ptyWrite(link.target, `${PASTE_START}${pointer}${PASTE_END}`)
          }
          return { ok: true, summary: `staged context for ${link.target}` }
        }
        return { ok: false, summary: `a context-inject link cannot target ${input.targetKind}` }
      }

      case 'a2a-peer': {
        const cfg = link.config
        if (cfg.kind !== 'a2a-peer') return { ok: false, summary: 'unknown link kind' }
        const res = await deps.a2aSend(link.target, input.source.text, { deliverReply: cfg.deliverReply })
        const replyNote = cfg.deliverReply && res?.reply ? ' (reply delivered)' : ''
        return { ok: true, summary: `sent to peer ${link.target}${replyNote}` }
      }

      default:
        return { ok: false, summary: 'unknown link kind' }
    }
  } catch (err) {
    return { ok: false, summary: `link failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}
