// File read/write for editor nodes — electron-free so the Server Edition
// can boot the same core. Never throws; errors ride on the result object.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname } from 'node:path'

export type FileKind = 'text' | 'markdown' | 'image' | 'binary'

export type FileErrorCode = 'MISSING' | 'IO' | 'UNSUPPORTED'

export type FileReadResult =
  | { kind: 'text'; content: string }
  | { kind: 'markdown'; content: string }
  | { kind: 'image' }
  | { error: { code: FileErrorCode; message: string } }

export type FileWriteResult = { ok: true } | { error: { code: FileErrorCode; message: string } }

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
