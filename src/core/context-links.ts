// Context link files (Phase 7, Task 7.5).
//
// Two agent nodes can share transcript context on demand via a link — a small
// file on disk, one per node pair, so a host CLI can resolve peers without
// going through Electron. Electron-free; pure fs helpers that never throw.
//
// Layout (order-independent, canonical pair):
//   <cwd>/.termsprawl/links/<idA>--<idB>.json     idA < idB lexicographically
//   { "version": 1, "a": "<idA>", "b": "<idB>" }

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isSafeProjectId } from './workspace-files'

export interface LinkPair {
  a: string
  b: string
}

export type LinkErrorCode = 'SELF' | 'BAD_ID' | 'IO'

export type LinkResult = { ok: true } | { error: { code: LinkErrorCode; message: string } }

const LINKS_DIR = 'links'
const LINK_FILE_VERSION = 1
const LINKS_ROOT = '.termsprawl'

function linksDir(cwd: string): string {
  return join(cwd, LINKS_ROOT, LINKS_DIR)
}

/** Canonical (lo, hi) ordering for a pair of node ids. */
function orderedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a]
}

/** Canonical pair path. Indep of argument order: (b,a) === (a,b). */
export function linkFilePath(cwd: string, a: string, b: string): string {
  const [lo, hi] = orderedPair(a, b)
  return join(linksDir(cwd), `${lo}--${hi}.json`)
}

/** Parse a raw link file body; null when junk, wrong version, or unsafe ids. */
export function parseLinkFile(raw: string): LinkPair | null {
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; a?: unknown; b?: unknown }
    if (parsed.version !== LINK_FILE_VERSION) return null
    if (!isSafeProjectId(parsed.a) || !isSafeProjectId(parsed.b)) return null
    if (parsed.a === parsed.b) return null
    return { a: parsed.a, b: parsed.b }
  } catch {
    return null
  }
}

/** List every valid link in the project folder. Never throws. */
export function listLinks(cwd: string): Array<LinkPair & { path: string }> {
  const dir = linksDir(cwd)
  if (!existsSync(dir)) return []
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  const links: Array<LinkPair & { path: string }> = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const path = join(dir, name)
    try {
      const pair = parseLinkFile(readFileSync(path, 'utf8'))
      if (pair) links.push({ ...pair, path })
    } catch {
      // unreadable file — skip, keep fail-open
    }
  }
  return links
}

/** Write a link file (idempotent). Never throws; errors ride on the result. */
export function addLink(cwd: string, a: string, b: string): LinkResult {
  if (!isSafeProjectId(a) || !isSafeProjectId(b)) {
    return { error: { code: 'BAD_ID', message: 'invalid node id' } }
  }
  if (a === b) {
    return { error: { code: 'SELF', message: 'cannot link a node to itself' } }
  }
  const [lo, hi] = orderedPair(a, b)
  try {
    mkdirSync(linksDir(cwd), { recursive: true })
    writeFileSync(
      linkFilePath(cwd, a, b),
      JSON.stringify({ version: LINK_FILE_VERSION, a: lo, b: hi }, null, 2) + '\n',
      'utf8'
    )
    return { ok: true }
  } catch (err) {
    return { error: { code: 'IO', message: String(err) } }
  }
}

/** Delete a link file. A missing file is fine; never throws. */
export function removeLink(cwd: string, a: string, b: string): void {
  if (!isSafeProjectId(a) || !isSafeProjectId(b) || a === b) return
  try {
    rmSync(linkFilePath(cwd, a, b), { force: true })
  } catch {
    // leave it — fail-open
  }
}

/** The ids linked to `id`, in no particular order. */
export function peersOf(cwd: string, id: string): string[] {
  if (!isSafeProjectId(id)) return []
  return listLinks(cwd)
    .filter((link) => link.a === id || link.b === id)
    .map((link) => (link.a === id ? link.b : link.a))
}
