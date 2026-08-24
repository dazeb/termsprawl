// Guards the core + server boundary: src/core and src/server must never import
// electron (or ../main). The Server Edition boots the same core, so a stray
// electron import would crash it — and silently.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// The test lives in src/core/, so __dirname IS the core dir.
const ROOTS = [__dirname, join(__dirname, '../server')]
const FORBIDDEN_PATTERNS = [
  /from\s+['"]electron['"]/,
  /require\(['"]electron['"]\)/,
  /from\s+['"]\.\.\/main/,
  /require\(['"]\.\.\/main/
]

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full))
    } else if (/\.(ts|tsx|js|mjs)$/.test(entry) && !entry.endsWith('.test.ts')) {
      out.push(full)
    }
  }
  return out
}

describe('core + server boundary', () => {
  it('never imports electron or ../main', () => {
    const offenders: string[] = []
    for (const root of ROOTS) {
      for (const file of sourceFiles(root)) {
        const content = readFileSync(file, 'utf8')
        for (const line of content.split('\n')) {
          const hit = FORBIDDEN_PATTERNS.find((p) => p.test(line))
          if (hit) {
            offenders.push(`${relative(__dirname, file)}: ${hit}`)
            break
          }
        }
      }
    }
    expect(offenders, 'forbidden imports found').toEqual([])
  })
})
