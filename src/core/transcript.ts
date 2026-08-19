// Transcript session-name reader (Phase 7, Task 7.4).
//
// Agent CLIs (Claude Code today) write a JSONL transcript per session; summary
// entries carry a human-friendly `session_name` that `/rename` updates. The
// node title mirrors that name so the canvas shows the agent's own session
// name — read from the transcript, never from OSC title escapes. Electron-free;
// the hook server (main) and future Server Edition both use it.

import { readFileSync } from 'node:fs'

interface TranscriptLine {
  type?: unknown
  session_name?: unknown
  [key: string]: unknown
}

// Task 7.5 caps for the linked-context dump: last N turns, each truncated to
// M chars so stdout stays small and safe.
export const MAX_LINKED_TURNS = 40
export const LINKED_TURN_MAX_CHARS = 2000

export interface TranscriptTurn {
  role: 'user' | 'assistant'
  text: string
}

/**
 * Read the latest non-null `session_name` from a Claude Code JSONL transcript.
 * Fail-open: a missing file, unparseable lines, or absent names all yield null
 * so the caller can keep the existing node title without breaking anything.
 */
export function readSessionNameFromTranscript(path: string): string | null {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return null
  }

  let latest: string | null = null
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let entry: TranscriptLine
    try {
      entry = JSON.parse(line) as TranscriptLine
    } catch {
      continue // malformed line — skip, keep fail-open
    }
    if (typeof entry.session_name === 'string' && entry.session_name.length > 0) {
      latest = entry.session_name
    }
  }
  return latest
}

/**
 * Extract the printable user/assistant text from a Claude message `content`,
 * which is a plain string or an array of typed blocks. Only `text` blocks
 * survive; tool_use / tool_result / thinking blocks are dropped. Returns null
 * when there is no printable text.
 */
function contentToText(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const texts: string[] = []
    for (const block of content) {
      if (block && typeof block === 'object' && (block as { type?: unknown }).type === 'text') {
        const text = (block as { text?: unknown }).text
        if (typeof text === 'string') texts.push(text)
      }
    }
    if (texts.length === 0) return null
    return texts.join('\n')
  }
  return null
}

/**
 * Read the printable user/assistant turns from a Claude JSONL transcript.
 * Fail-open: a missing file, junk lines, and non-user/assistant entries are
 * skipped. Tool-use interleaving is dropped. Returns the last
 * `MAX_LINKED_TURNS` turns with text truncated to `LINKED_TURN_MAX_CHARS`.
 */
export function readTranscriptTurns(path: string): TranscriptTurn[] {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return []
  }

  const turns: TranscriptTurn[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let entry: TranscriptLine
    try {
      entry = JSON.parse(line) as TranscriptLine
    } catch {
      continue // malformed line — skip, keep fail-open
    }
    if (entry.type !== 'user' && entry.type !== 'assistant') continue
    const message = entry.message
    if (!message || typeof message !== 'object') continue
    const content = (message as { content?: unknown }).content
    const textVal = contentToText(content)
    if (textVal === null) continue
    turns.push({ role: entry.type, text: textVal.slice(0, LINKED_TURN_MAX_CHARS) })
  }
  return turns.slice(-MAX_LINKED_TURNS)
}

/**
 * The exact stdout dump the context CLI prints for one peer transcript.
 */
export function formatLinkedContext(opts: {
  peerId: string
  peerTitle: string
  turns: TranscriptTurn[]
}): string {
  const lines = [`# linked context from ${opts.peerTitle} (${opts.peerId})`]
  for (const turn of opts.turns) {
    lines.push(`## ${turn.role}`, turn.text)
  }
  return lines.join('\n')
}
