// Transcript path index (Phase 7, Task 7.5).
//
// The app learns each agent node's transcript path from hook events, but the
// standalone context CLI is a one-shot process with no event history — so the
// app persists that mapping to disk, one file per node, under the project
// folder. Electron-free; fail-open; never throws.
//
// Layout:
//   <cwd>/.termsprawl/transcripts/<nodeId>.json
//   { "version": 1, "path": "/abs/path/to/<session>.jsonl" }

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isSafeProjectId } from './workspace-files'

const TRANSCRIPTS_DIR = 'transcripts'
const INDEX_VERSION = 1

export function transcriptIndexFilePath(cwd: string, nodeId: string): string {
  return join(cwd, '.termsprawl', TRANSCRIPTS_DIR, `${nodeId}.json`)
}

/** Remember where a node's transcript lives. No-op on unsafe ids; never throws. */
export function recordTranscriptPath(cwd: string, nodeId: string, path: string): void {
  if (!isSafeProjectId(nodeId) || typeof path !== 'string' || path.length === 0) return
  try {
    const filePath = transcriptIndexFilePath(cwd, nodeId)
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, JSON.stringify({ version: INDEX_VERSION, path }, null, 2) + '\n', 'utf8')
  } catch {
    // fail-open: a lost index is not worth crashing the hook path
  }
}

/** The stored transcript path for a node, or null when unknown/unreadable. */
export function readTranscriptPath(cwd: string, nodeId: string): string | null {
  if (!isSafeProjectId(nodeId)) return null
  try {
    if (!existsSync(transcriptIndexFilePath(cwd, nodeId))) return null
    const parsed = JSON.parse(readFileSync(transcriptIndexFilePath(cwd, nodeId), 'utf8')) as {
      version?: unknown
      path?: unknown
    }
    if (parsed.version !== INDEX_VERSION) return null
    if (typeof parsed.path !== 'string' || parsed.path.length === 0) return null
    return parsed.path
  } catch {
    return null
  }
}
