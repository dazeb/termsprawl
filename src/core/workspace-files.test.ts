import { afterEach, describe, expect, it } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureFolderProjectRoot } from './workspace-files'

// ensureFolderProjectRoot guards the browser/server folder-project flow: the
// shim accepts a TYPED path (desktop uses a native picker that only returns
// existing folders), so a bogus or unwritable directory must fail here with a
// clear message instead of a raw EACCES on the first node save.

const dirs: string[] = []

function tmp(name: string): string {
  const d = join(mkdtempSync(join(tmpdir(), 'ts-wf-')), name)
  dirs.push(d)
  mkdirSync(d, { recursive: true })
  return d
}

afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      chmodSync(d, 0o755)
      rmSync(d, { recursive: true, force: true })
    } catch {
      // already gone
    }
  }
})

describe('ensureFolderProjectRoot', () => {
  it('accepts an existing writable folder and prepares the .termsprawl dir', () => {
    const d = tmp('proj')
    expect(() => ensureFolderProjectRoot(d)).not.toThrow()
    // Idempotent — a second call (dedupe re-check) is a no-op.
    expect(() => ensureFolderProjectRoot(d)).not.toThrow()
  })

  it('rejects a folder that does not exist with an actionable message', () => {
    const missing = join(tmp('parent'), 'no-such-folder')
    let msg = ''
    try {
      ensureFolderProjectRoot(missing)
    } catch (e) {
      msg = (e as Error).message
    }
    expect(msg).toContain('No such folder')
    expect(msg).toContain(missing)
    expect(msg).toContain('EXISTING directory')
  })

  it('rejects a path that is a file, not a folder', () => {
    const d = tmp('proj')
    const f = join(d, 'notes.txt')
    writeFileSync(f, 'hi')
    let msg = ''
    try {
      ensureFolderProjectRoot(f)
    } catch (e) {
      msg = (e as Error).message
    }
    expect(msg).toContain('Not a folder')
  })

  it('rejects an unwritable folder with a permission message', () => {
    const d = tmp('proj')
    chmodSync(d, 0o555) // read+execute only — mkdir inside must EACCES
    let msg = ''
    try {
      ensureFolderProjectRoot(d)
    } catch (e) {
      msg = (e as Error).message
    } finally {
      chmodSync(d, 0o755)
    }
    expect(msg).toContain('Cannot write into')
    expect(msg).toContain('permission denied')
  })
})
