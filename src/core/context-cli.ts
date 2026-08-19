// Context CLI logic (Phase 7, Task 7.5).
//
// The standalone `termsprawl-context` host command prints a linked peer's
// recent transcript turns. This module is the single implementation; the
// shipped `scripts/termsprawl-context.mjs` is a thin argv/io wrapper around it
// (bundled from this file). Tests run it in-process with an injected io.
//
// Pure-ish: no electron, never throws.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { peersOf } from './context-links'
import { readTranscriptPath } from './transcript-index'
import { readTranscriptTurns, formatLinkedContext } from './transcript'
import type { TranscriptTurn } from './transcript'

export interface ContextCliIO {
  /** Linked peer node ids for `self`. */
  peers(self: string): string[]
  /** Stored transcript path for a node id, or null. */
  transcriptPath(nodeId: string): string | null
  /** Canvas title for a node id, or null to fall back to the id. */
  nodeTitle(nodeId: string): string | null
  /** Printable user/assistant turns from a transcript path. */
  turns(path: string): TranscriptTurn[]
  /** Emit one line / block of stdout. */
  print(text: string): void
}

export type ParseContextArgsResult = { cwd: string; self: string } | { error: string }

/**
 * Minimal argv parser for `--cwd <project> --self <nodeId>`.
 * Returns `{ error }` (caller exits 2) on anything unrecognized.
 */
export function parseContextArgs(argv: string[]): ParseContextArgsResult {
  let cwd: string | null = null
  let self: string | null = null
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--cwd') {
      cwd = argv[++i]
      if (cwd === undefined) return { error: 'missing value for --cwd' }
    } else if (arg === '--self') {
      self = argv[++i]
      if (self === undefined) return { error: 'missing value for --self' }
    } else {
      return { error: `unexpected argument: ${arg}` }
    }
  }
  if (cwd === null || self === null) return { error: 'expected --cwd and --self' }
  return { cwd, self }
}

/**
 * Print every linked peer's formatted transcript dump, separated by `\n---\n`.
 * Returns a process exit code: 0 always (prints nothing when there are no
 * peers or no readable turns).
 */
export function runContextCli(opts: { cwd: string; self: string }, io: ContextCliIO): number {
  const peers = io.peers(opts.self)
  if (peers.length === 0) return 0

  const blocks: string[] = []
  for (const peer of peers) {
    const path = io.transcriptPath(peer)
    if (!path) continue
    const turns = io.turns(path)
    if (turns.length === 0) continue
    const title = io.nodeTitle(peer) ?? peer
    blocks.push(formatLinkedContext({ peerId: peer, peerTitle: title, turns }))
  }
  if (blocks.length === 0) return 0
  io.print(blocks.join('\n---\n'))
  return 0
}

/** Real io backed by the project folder on disk. */
export function createRealContextIO(cwd: string): ContextCliIO {
  function nodeTitle(nodeId: string): string | null {
    try {
      const parsed = JSON.parse(
        readFileSync(join(cwd, '.termsprawl', 'project.json'), 'utf8')
      ) as { nodes?: Array<{ id: unknown; data?: Record<string, unknown> }> }
      const node = (parsed.nodes ?? []).find((n) => n.id === nodeId && n.data && typeof n.data === 'object')
      const title = node?.data?.['title']
      if (typeof title === 'string') return title
      return null
    } catch {
      return null
    }
  }

  return {
    peers: (self) => peersOf(cwd, self),
    transcriptPath: (nodeId) => readTranscriptPath(cwd, nodeId),
    nodeTitle,
    turns: (path) => readTranscriptTurns(path),
    print: (text) => console.log(text)
  }
}
