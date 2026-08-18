// File read/write for editor nodes — electron-free so the Server Edition
// can boot the same core. Never throws; errors ride on the result object.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve, sep } from 'node:path'

export type FileKind = 'text' | 'markdown' | 'image' | 'binary'

export type FileErrorCode = 'MISSING' | 'IO' | 'UNSUPPORTED'

export type FileReadResult =
  | { kind: 'text'; content: string }
  | { kind: 'markdown'; content: string }
  | { kind: 'image' }
  | { error: { code: FileErrorCode; message: string } }

export type FileWriteResult = { ok: true } | { error: { code: FileErrorCode; message: string } }

export type DirEntryKind = 'dir' | 'file'

export interface DirEntry {
  name: string
  path: string
  kind: DirEntryKind
}

export type DirListResult =
  | { entries: DirEntry[] }
  | { error: { code: 'MISSING' | 'IO' | 'OUTSIDE'; message: string } }

const SKIP_NAMES = new Set(['node_modules', '.git'])

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'])
const MARKDOWN_EXT = new Set(['md', 'markdown'])
const BINARY_EXT = new Set([
  'zip',
  'gz',
  'tgz',
  'bz2',
  'xz',
  '7z',
  'rar',
  'pdf',
  'exe',
  'dll',
  'so',
  'dylib',
  'wasm',
  'bin',
  'woff',
  'woff2',
  'ttf',
  'otf',
  'mp3',
  'mp4',
  'webm',
  'ogg',
  'wav'
])

function extensionOf(filePath: string): string {
  const ext = extname(filePath)
  return ext.startsWith('.') ? ext.slice(1).toLowerCase() : ext.toLowerCase()
}

/** Classify a path by extension. Unknown extensions are treated as text. */
export function classifyFile(filePath: string): FileKind {
  const ext = extensionOf(filePath)
  if (MARKDOWN_EXT.has(ext)) return 'markdown'
  if (IMAGE_EXT.has(ext)) return 'image'
  if (BINARY_EXT.has(ext)) return 'binary'
  return 'text'
}

export function readProjectFile(filePath: string): FileReadResult {
  const kind = classifyFile(filePath)
  if (kind === 'binary') {
    return { error: { code: 'UNSUPPORTED', message: 'binary file — open it elsewhere' } }
  }
  if (kind === 'image') {
    if (!existsSync(filePath)) {
      return { error: { code: 'MISSING', message: 'file not found' } }
    }
    return { kind: 'image' }
  }
  try {
    const content = readFileSync(filePath, 'utf8')
    return kind === 'markdown' ? { kind: 'markdown', content } : { kind: 'text', content }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return { error: { code: 'MISSING', message: 'file not found' } }
    }
    return { error: { code: 'IO', message: String(err) } }
  }
}

export function writeProjectFile(filePath: string, content: string): FileWriteResult {
  try {
    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
      return { error: { code: 'IO', message: 'path is a directory' } }
    }
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, content, 'utf8')
    return { ok: true }
  } catch (err) {
    return { error: { code: 'IO', message: String(err) } }
  }
}

function resolveInside(root: string, rel = '.'): string | null {
  const rootAbs = resolve(root)
  const target = resolve(rootAbs, rel)
  if (target !== rootAbs && !target.startsWith(rootAbs + sep)) return null
  return target
}

function skipEntry(name: string): boolean {
  return name.startsWith('.') || SKIP_NAMES.has(name)
}

/** List one folder under the project root. Never walks outside `root`. */
export function listProjectDir(root: string, rel = '.'): DirListResult {
  const target = resolveInside(root, rel)
  if (!target) {
    return { error: { code: 'OUTSIDE', message: 'path is outside the project folder' } }
  }
  try {
    const stat = statSync(target)
    if (!stat.isDirectory()) {
      return { error: { code: 'IO', message: 'path is not a folder' } }
    }
    const names = readdirSync(target).filter((name) => !skipEntry(name))
    const entries: DirEntry[] = names.map((name) => {
      const path = join(target, name)
      let kind: DirEntryKind = 'file'
      try {
        kind = statSync(path).isDirectory() ? 'dir' : 'file'
      } catch {
        kind = 'file'
      }
      return { name, path, kind }
    })
    entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    return { entries }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return { error: { code: 'MISSING', message: 'folder not found' } }
    }
    return { error: { code: 'IO', message: String(err) } }
  }
}
