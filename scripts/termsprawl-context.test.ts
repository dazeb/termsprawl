// Smoke test: the committed scripts/termsprawl-context.mjs is a real, plain-node
// CLI. Exercises it end-to-end against a temp project folder (link file +
// transcript index + project.json). The in-process logic is covered in
// src/core/context-cli.test.ts; this only proves the wrapper runs and wires up.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { addLink } from '../src/core/context-links'
import { recordTranscriptPath } from '../src/core/transcript-index'

const CLI = resolve(fileURLToPath(new URL('termsprawl-context.mjs', import.meta.url)))

function run(cwd: string, self: string): { stdout: string; stderr: string; status: number | null } {
  const res = spawnSync(process.execPath, [CLI, '--cwd', cwd, '--self', self], {
    encoding: 'utf8'
  })
  return { stdout: res.stdout, stderr: res.stderr, status: res.status }
}

describe('scripts/termsprawl-context.mjs', () => {
  let cwd: string

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'termsprawl-cli-smoke-'))
  })

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  it('prints a linked peer dump and exits 0', () => {
    const transcript = join(cwd, 'peer-b.jsonl')
    writeFileSync(
      transcript,
      [
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'do the thing' } }),
        JSON.stringify({
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] }
        })
      ].join('\n') + '\n',
      'utf8'
    )
    addLink(cwd, 'node-a', 'node-b')
    recordTranscriptPath(cwd, 'node-b', transcript)
    writeFileSync(
      join(cwd, '.termsprawl', 'project.json'),
      JSON.stringify({
        version: 1,
        rev: 1,
        nodes: [{ id: 'node-b', type: 'terminal', position: { x: 0, y: 0 }, data: { title: 'Claude B' } }]
      }),
      'utf8'
    )

    const { stdout, stderr, status } = run(cwd, 'node-a')
    expect(status).toBe(0)
    expect(stderr).toBe('')
    expect(stdout).toBe(
      ['# linked context from Claude B (node-b)', '## user', 'do the thing', '## assistant', 'done'].join('\n') + '\n'
    )
  })

  it('prints nothing and exits 0 with no linked peers', () => {
    mkdirSync(join(cwd, '.termsprawl'), { recursive: true })
    const { stdout, stderr, status } = run(cwd, 'node-a')
    expect(status).toBe(0)
    expect(stdout).toBe('')
    expect(stderr).toBe('')
  })
})
