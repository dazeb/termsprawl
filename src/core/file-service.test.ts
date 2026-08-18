import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classifyFile, readProjectFile, writeProjectFile } from './file-service'

describe('file-service', () => {
  const dirs: string[] = []

  function scratch(): string {
    const dir = mkdtempSync(join(tmpdir(), 'termsprawl-file-'))
    dirs.push(dir)
    return dir
  }

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('classifies markdown, images, text, and known binaries', () => {
    expect(classifyFile('/repo/README.md')).toBe('markdown')
    expect(classifyFile('/repo/notes.markdown')).toBe('markdown')
    expect(classifyFile('/repo/shot.png')).toBe('image')
    expect(classifyFile('/repo/photo.JPEG')).toBe('image')
    expect(classifyFile('/repo/src/app.ts')).toBe('text')
    expect(classifyFile('/repo/archive.zip')).toBe('binary')
    expect(classifyFile('/repo/doc.pdf')).toBe('binary')
  })

  it('reads a utf8 text file', () => {
    const dir = scratch()
    const path = join(dir, 'hello.ts')
    writeFileSync(path, 'export const n = 1\n')
    expect(readProjectFile(path)).toEqual({ kind: 'text', content: 'export const n = 1\n' })
  })

  it('reads markdown as markdown kind', () => {
    const dir = scratch()
    const path = join(dir, 'notes.md')
    writeFileSync(path, '# hi\n')
    expect(readProjectFile(path)).toEqual({ kind: 'markdown', content: '# hi\n' })
  })

  it('does not load image bytes; reports image kind', () => {
    const dir = scratch()
    const path = join(dir, 'dot.png')
    writeFileSync(path, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    expect(readProjectFile(path)).toEqual({ kind: 'image' })
  })

  it('refuses known binary extensions', () => {
    const dir = scratch()
    const path = join(dir, 'pack.zip')
    writeFileSync(path, 'PK')
    const result = readProjectFile(path)
    expect(result).toMatchObject({ error: { code: 'UNSUPPORTED' } })
  })

  it('returns MISSING when the path is absent', () => {
    const result = readProjectFile(join(scratch(), 'nope.ts'))
    expect(result).toMatchObject({ error: { code: 'MISSING' } })
  })

  it('writes utf8 and can be read back', () => {
    const dir = scratch()
    const path = join(dir, 'out.txt')
    expect(writeProjectFile(path, 'saved\n')).toEqual({ ok: true })
    expect(readProjectFile(path)).toEqual({ kind: 'text', content: 'saved\n' })
  })

  it('creates parent directories on write', () => {
    const dir = scratch()
    const path = join(dir, 'nested', 'dir', 'file.ts')
    expect(writeProjectFile(path, 'ok')).toEqual({ ok: true })
    expect(readProjectFile(path)).toEqual({ kind: 'text', content: 'ok' })
  })

  it('returns IO when writing to a directory path', () => {
    const dir = scratch()
    mkdirSync(join(dir, 'folder'))
    const result = writeProjectFile(join(dir, 'folder'), 'nope')
    expect(result).toMatchObject({ error: { code: 'IO' } })
  })
})
