// Audit B3 — first chat tool set: read_file / list_dir, scoped to a known
// project folder. Electron-free (works for the Server Edition runtime too);
// confinement comes from resolveFileScope against the WorkspaceStore, so a
// prompt-injected path argument can never escape the project the chat node
// lives in. Output is byte-capped: tool results ride in the transcript and
// would otherwise blow the history cap immediately.
//
// Clean-room: written fresh for termsprawl; nothing copied from any project.

import { readProjectFile, listProjectDir, classifyFile } from '../file-service'
import { resolveFileScope } from '../project-scope'
import type { WorkspaceStore } from '../workspace-store'
import type { ChatToolDef } from './tools'
import { isAbsolute, resolve as resolvePath } from 'node:path'

/** Where the chat is anchored: tools stay inside this project. */
export interface ChatToolScope {
  cwd?: string
  projectId?: string
}

const MAX_RESULT_BYTES = 12 * 1024

function cap(text: string): string {
  if (text.length <= MAX_RESULT_BYTES) return text
  return (
    text.slice(0, MAX_RESULT_BYTES) +
    `\n[truncated ${text.length - MAX_RESULT_BYTES} bytes]`
  )
}

type Json = Record<string, unknown>

/** Build the built-in tool set for a chat anchored in `scope`. Reads are
 * read-only and need no approval (write/execute tools come later and will). */
export function projectChatTools(store: WorkspaceStore, scope: ChatToolScope): ChatToolDef[] {
  const scoped = (rawPath: unknown): { path: string } | { error: string } => {
    if (typeof rawPath !== 'string' || rawPath.trim() === '') {
      return { error: 'path must be a non-empty string' }
    }
    const raw = rawPath.trim()
    // resolveFileScope matches literal absolute prefixes; give it an absolute
    // path by resolving relative arguments against the chat's project folder.
    const abs = isAbsolute(raw)
      ? raw
      : scope.cwd
        ? resolvePath(scope.cwd, raw)
        : null
    if (!abs) return { error: 'path must be absolute (no project folder to resolve against)' }
    const res = resolveFileScope(store, abs, scope)
    return res.ok ? { path: res.path } : { error: res.reason }
  }

  const readFile: ChatToolDef = {
    name: 'read_file',
    description:
      'Read a text file inside the current project folder. Returns the file content (truncated when huge). Refuses paths outside the project.',
    schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'absolute path inside the project folder' } },
      required: ['path']
    },
    needsApproval: false,
    run: async (args) => {
      const s = scoped((args as Json).path)
      if ('error' in s) return s.error
      const kind = classifyFile(s.path)
      if (kind === 'image') return `image file (${s.path}) — not readable as text`
      if (kind === 'binary') return `binary file (${s.path}) — not readable as text`
      const res = readProjectFile(s.path)
      if ('error' in res) return `read failed: ${res.error.message}`
      if (!('content' in res)) return `${res.kind} file (${s.path}) — no text content`
      return cap(res.content ?? '')
    }
  }

  const listDir: ChatToolDef = {
    name: 'list_dir',
    description:
      'List a folder inside the current project folder (default: the project root). Returns one entry per line, files and directories marked. Refuses paths outside the project.',
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'folder path inside the project (omit for the project root)' }
      }
    },
    needsApproval: false,
    run: async (args) => {
      const raw = (args as Json).path
      const rel = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : '.'
      const s = scoped(rel)
      if ('error' in s) return s.error
      // listProjectDir takes a root + RELATIVE path; run it with the scoped
      // path as its own root so traversal stays confined.
      const res = listProjectDir(s.path, '.')
      if ('error' in res) return `list failed: ${res.error.message}`
      if (!res.entries || res.entries.length === 0) return '(empty)'
      const lines = res.entries.map((e) => `${e.kind === 'dir' ? 'd' : 'f'} ${e.name}`)
      return cap(lines.join('\n'))
    }
  }

  return [readFile, listDir]
}
