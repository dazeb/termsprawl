// Audit B3 — project-scoped chat tools. Real fs via temp dirs, no network.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkspaceStore } from '../workspace-store'
import { projectChatTools } from './project-tools'
import type { CorePlatform } from '../platform'

// Minimal CorePlatform stub (workspace-store only needs userDataPath).
function stubPlatform(userDataPath: string): CorePlatform {
  return { userDataPath, broadcast: () => {} } as unknown as CorePlatform
}

let root: string
let store: WorkspaceStore

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'termsprawl-chat-tools-'))
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'README.md'), '# hello\n')
  writeFileSync(join(root, 'src', 'app.ts'), 'export const x = 1\n')
  writeFileSync(join(root, 'logo.png'), 'not really a png')
  writeFileSync(join(root, 'blob.bin'), '\u0000\u0001\u0002')
  // A decoy OUTSIDE the project: tools must refuse to touch it.
  const outsideDir = mkdtempSync(join(tmpdir(), 'termsprawl-outside-'))
  writeFileSync(join(outsideDir, 'secret.txt'), 'top secret')
  store = new WorkspaceStore(stubPlatform(root))
  store.addProject('proj', root)
  // No external cleanup needed for the outside dir beyond this test run.
  rmSync(outsideDir, { recursive: true, force: true })
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

const tools = (): { read_file: ReturnType<typeof projectChatTools>[number]; list_dir: ReturnType<typeof projectChatTools>[number] } => {
  const all = projectChatTools(store, { cwd: root })
  return {
    read_file: all.find((t) => t.name === 'read_file')!,
    list_dir: all.find((t) => t.name === 'list_dir')!
  }
}

describe('projectChatTools', () => {
  it('exposes read_file and list_dir, read-only (no approval needed)', () => {
    const { read_file, list_dir } = tools()
    expect(read_file.name).toBe('read_file')
    expect(list_dir.name).toBe('list_dir')
    expect(read_file.needsApproval).toBe(false)
    expect(list_dir.needsApproval).toBe(false)
    expect(read_file.schema).toBeTruthy()
  })

  it('read_file returns in-project text content', async () => {
    const { read_file } = tools()
    await expect(read_file.run({ path: join(root, 'README.md') })).resolves.toBe('# hello\n')
    await expect(read_file.run({ path: join(root, 'src', 'app.ts') })).resolves.toBe('export const x = 1\n')
  })

  it('read_file refuses paths outside the known project', async () => {
    const { read_file } = tools()
    const out = await read_file.run({ path: '/etc/hostname' })
    expect(out).toMatch(/outside/)
  })

  it('read_file rejects a non-string path', async () => {
    const { read_file } = tools()
    await expect(read_file.run({ path: 42 })).resolves.toMatch(/non-empty string/)
    await expect(read_file.run({})).resolves.toMatch(/non-empty string/)
  })

  it('read_file reports (not reads) image and binary files', async () => {
    const { read_file } = tools()
    await expect(read_file.run({ path: join(root, 'logo.png') })).resolves.toMatch(/image file/)
    await expect(read_file.run({ path: join(root, 'blob.bin') })).resolves.toMatch(/binary file/)
  })

  it('read_file reports a missing file without throwing', async () => {
    const { read_file } = tools()
    await expect(read_file.run({ path: join(root, 'nope.md') })).resolves.toMatch(/read failed/)
  })

  it('list_dir marks dirs vs files and defaults to the project root', async () => {
    const { list_dir } = tools()
    const out = (await list_dir.run({})) as string
    expect(out).toContain('d src')
    expect(out).toContain('f README.md')
    expect(out).toContain('f logo.png')
  })

  it('list_dir lists a subfolder and refuses escapes (../..)', async () => {
    const { list_dir } = tools()
    await expect(list_dir.run({ path: join(root, 'src') })).resolves.toBe('f app.ts')
    const out = await list_dir.run({ path: join(root, '..', '..', 'etc') })
    expect(out).toMatch(/outside/)
  })

  it('truncates huge file output to the byte cap', async () => {
    const big = mkdtempSync(join(tmpdir(), 'termsprawl-big-'))
    writeFileSync(join(big, 'big.txt'), 'x'.repeat(50 * 1024))
    store.addProject('big-proj', big)
    const all = projectChatTools(store, { cwd: big })
    const read_file = all.find((t) => t.name === 'read_file')!
    const out = (await read_file.run({ path: join(big, 'big.txt') })) as string
    expect(out.length).toBeLessThan(50 * 1024)
    expect(out).toContain('[truncated')
    rmSync(big, { recursive: true, force: true })
  })
})
