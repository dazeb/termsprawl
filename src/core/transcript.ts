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
