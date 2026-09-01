import { describe, expect, it } from 'vitest'
import type { NodeLink } from '@shared/types'
import { runLink, defaultOutputPath, type LinkEngineDeps } from './engine'
import type { SourceContent } from './registry'

const NOW = 1756710000000
const ISO = new Date(NOW).toISOString()

function link(overrides: Partial<NodeLink> = {}): NodeLink {
  return {
    id: 'link-1',
    source: 'src-1',
    target: 'tgt-1',
    kind: 'file-output',
    auto: false,
    config: { kind: 'file-output', path: 'out/notes.md', mode: 'overwrite', header: true },
    createdAt: NOW,
    ...overrides
  }
}

interface DepCalls {
  writes: Array<{ path: string; content: string }>
  appends: Array<{ path: string; content: string }>
  mkdirs: string[]
  chatAppends: Array<{ nodeId: string; message: { role: string; content: string } }>
  broadcasts: Array<{ nodeId: string; event: { kind: string; sourceTitle: string } }>
  ptyWrites: Array<{ nodeId: string; data: string }>
  a2aSends: Array<{ peerId: string; text: string; opts: { deliverReply: boolean } }>
}

function deps(overrides: Partial<LinkEngineDeps> = {}): { d: LinkEngineDeps; c: DepCalls } {
  const c: DepCalls = { writes: [], appends: [], mkdirs: [], chatAppends: [], broadcasts: [], ptyWrites: [], a2aSends: [] }
  const d: LinkEngineDeps = {
    writeFile: async (path, content) => void c.writes.push({ path, content }),
    appendFile: async (path, content) => void c.appends.push({ path, content }),
    mkdirp: async (path) => void c.mkdirs.push(path),
    resolveOutputPath: (_root, rel) => `/project/${rel}`,
    chatAppend: async (nodeId, message) => void c.chatAppends.push({ nodeId, message }),
    chatBroadcast: async (nodeId, event) => void c.broadcasts.push({ nodeId, event }),
    ptyWrite: async (nodeId, data) => void c.ptyWrites.push({ nodeId, data }),
    a2aSend: async (peerId, text, opts) => {
      c.a2aSends.push({ peerId, text, opts })
      return {}
    },
    now: () => NOW,
    ...overrides
  }
  return { d, c }
}

const text: SourceContent = { kind: 'text', text: 'hello world', title: 'build box' }

describe('runLink — empty source', () => {
  it('short-circuits without touching any injector', async () => {
    const { d, c } = deps()
    const out = await runLink(link(), { source: { kind: 'empty' }, targetKind: 'file', targetData: {}, projectRoot: '/project' }, d)
    expect(out).toEqual({ ok: false, summary: 'source is empty' })
    expect(c.writes).toHaveLength(0)
    expect(c.chatAppends).toHaveLength(0)
    expect(c.ptyWrites).toHaveLength(0)
    expect(c.a2aSends).toHaveLength(0)
  })
})

describe('runLink — file-output', () => {
  it('overwrites with a header comment', async () => {
    const { d, c } = deps()
    const out = await runLink(link(), { source: text, targetKind: 'file', targetData: {}, projectRoot: '/project' }, d)
    expect(out.ok).toBe(true)
    expect(c.writes).toEqual([
      { path: '/project/out/notes.md', content: `<!-- termsprawl link link-1 @ ${ISO} -->\n\nhello world` }
    ])
    expect(c.appends).toHaveLength(0)
    expect(out.summary).toContain('out/notes.md')
  })

  it('appends with a trailing newline when mode is append', async () => {
    const { d, c } = deps()
    const l = link({ config: { kind: 'file-output', path: 'log.md', mode: 'append', header: false } })
    const out = await runLink(l, { source: text, targetKind: 'file', targetData: {}, projectRoot: '/project' }, d)
    expect(out.ok).toBe(true)
    expect(c.appends).toEqual([{ path: '/project/log.md', content: 'hello world\n' }])
    expect(c.writes).toHaveLength(0)
  })

  it('derives a default path from the source title when none is set', async () => {
    const { d, c } = deps()
    const l = link({ config: { kind: 'file-output', path: '', mode: 'overwrite', header: true } })
    const out = await runLink(l, { source: text, targetKind: 'file', targetData: {}, projectRoot: '/project' }, d)
    expect(out.ok).toBe(true)
    expect(c.writes[0].path).toBe('/project/.termsprawl/outputs/build-box.md')
  })

  it('refuses a path that escapes the project root', async () => {
    const { d, c } = deps({ resolveOutputPath: () => { throw new Error('OUTSIDE') } })
    const out = await runLink(link(), { source: text, targetKind: 'file', targetData: {}, projectRoot: '/project' }, d)
    expect(out).toEqual({ ok: false, summary: 'output path escapes project root' })
    expect(c.writes).toHaveLength(0)
    expect(c.mkdirs).toHaveLength(0)
  })

  it('truncates content past the 1MB cap with a note', async () => {
    const { d, c } = deps()
    const big: SourceContent = { kind: 'text', text: 'x'.repeat(1_000_001), title: 'big' }
    const out = await runLink(link(), { source: big, targetKind: 'file', targetData: {}, projectRoot: '/project' }, d)
    expect(out.ok).toBe(true)
    const content = c.writes[0].content
    expect(content.length).toBeLessThan(1_000_001 + 200)
    expect(content).toContain('<!-- truncated at 1MB -->')
    expect(content).not.toContain('x'.repeat(1_000_001))
  })

  it('fails open when writeFile throws', async () => {
    const { d } = deps({ writeFile: async () => { throw new Error('disk full') } })
    const out = await runLink(link(), { source: text, targetKind: 'file', targetData: {}, projectRoot: '/project' }, d)
    expect(out.ok).toBe(false)
    expect(out.summary).toContain('link failed:')
  })
})

describe('runLink — context-inject → chat', () => {
  const chatLink = link({
    kind: 'context-inject',
    target: 'chat-9',
    config: { kind: 'context-inject', wrapper: true, pastePointer: true }
  })

  it('appends a wrapped user message and broadcasts context-added', async () => {
    const { d, c } = deps()
    const out = await runLink(chatLink, { source: text, targetKind: 'chat', targetData: {}, projectRoot: '/project' }, d)
    expect(out).toEqual({ ok: true, summary: 'injected into chat chat-9' })
    expect(c.chatAppends).toEqual([
      { nodeId: 'chat-9', message: { role: 'user', content: '[context from build box]\nhello world' } }
    ])
    expect(c.broadcasts).toEqual([{ nodeId: 'chat-9', event: { kind: 'context-added', sourceTitle: 'build box' } }])
  })

  it('skips the wrapper when disabled', async () => {
    const { d, c } = deps()
    const l = link({ kind: 'context-inject', target: 'chat-9', config: { kind: 'context-inject', wrapper: false, pastePointer: true } })
    await runLink(l, { source: text, targetKind: 'chat', targetData: {}, projectRoot: '/project' }, d)
    expect(c.chatAppends[0].message.content).toBe('hello world')
  })
})

describe('runLink — context-inject → agent terminal', () => {
  const termLink = link({
    kind: 'context-inject',
    target: 'agent-7',
    config: { kind: 'context-inject', wrapper: true, pastePointer: true }
  })

  it('stages a context file and pastes a one-line pointer with bracketed paste', async () => {
    const { d, c } = deps()
    const out = await runLink(termLink, { source: text, targetKind: 'terminal', targetData: {}, projectRoot: '/project' }, d)
    expect(out).toEqual({ ok: true, summary: 'staged context for agent-7' })
    expect(c.writes).toEqual([{ path: '/project/.termsprawl/links/context/agent-7.md', content: 'hello world' }])
    expect(c.ptyWrites).toHaveLength(1)
    const data = c.ptyWrites[0].data
    expect(data.startsWith('\x1b[200~')).toBe(true)
    expect(data.endsWith('\x1b[201~')).toBe(true)
    expect(data).toContain('.termsprawl/links/context/agent-7.md')
    expect(data).not.toContain('hello world')
  })

  it('skips the paste when pastePointer is false', async () => {
    const { d, c } = deps()
    const l = link({ kind: 'context-inject', target: 'agent-7', config: { kind: 'context-inject', wrapper: true, pastePointer: false } })
    const out = await runLink(l, { source: text, targetKind: 'terminal', targetData: {}, projectRoot: '/project' }, d)
    expect(out.ok).toBe(true)
    expect(c.writes).toHaveLength(1)
    expect(c.ptyWrites).toHaveLength(0)
  })

  it('refuses a staged path that escapes the project root', async () => {
    const { d, c } = deps({ resolveOutputPath: () => { throw new Error('OUTSIDE') } })
    const out = await runLink(termLink, { source: text, targetKind: 'terminal', targetData: {}, projectRoot: '/project' }, d)
    expect(out).toEqual({ ok: false, summary: 'output path escapes project root' })
    expect(c.ptyWrites).toHaveLength(0)
  })
})

describe('runLink — a2a-peer', () => {
  it('sends the payload to the peer and reports the reply', async () => {
    const { d, c } = deps({
      a2aSend: async (peerId, text, opts) => {
        c.a2aSends.push({ peerId, text, opts })
        return { reply: 'A2A-OK' }
      }
    })
    const l = link({ kind: 'a2a-peer', target: 'peer-web', config: { kind: 'a2a-peer', message: 'last-output', deliverReply: true } })
    const out = await runLink(l, { source: text, targetKind: 'a2a-peer', targetData: {}, projectRoot: '/project' }, d)
    expect(out.ok).toBe(true)
    expect(c.a2aSends).toEqual([{ peerId: 'peer-web', text: 'hello world', opts: { deliverReply: true } }])
    expect(out.summary).toContain('peer-web')
    expect(out.summary).toContain('reply delivered')
  })

  it('passes deliverReply=false through and omits the reply note', async () => {
    const { d, c } = deps()
    const l = link({ kind: 'a2a-peer', target: 'peer-web', config: { kind: 'a2a-peer', message: 'full-capture', deliverReply: false } })
    const out = await runLink(l, { source: text, targetKind: 'a2a-peer', targetData: {}, projectRoot: '/project' }, d)
    expect(out.ok).toBe(true)
    expect(c.a2aSends[0].opts).toEqual({ deliverReply: false })
    expect(out.summary).not.toContain('reply delivered')
  })
})

describe('runLink — defensive', () => {
  it('rejects an unknown link kind', async () => {
    const { d } = deps()
    const l = link({ kind: 'wat' as never, config: { kind: 'file-output', path: 'x', mode: 'overwrite', header: false } })
    const out = await runLink(l, { source: text, targetKind: 'file', targetData: {}, projectRoot: '/project' }, d)
    expect(out).toEqual({ ok: false, summary: 'unknown link kind' })
  })

  it('survives an unexpected injector crash', async () => {
    const { d } = deps({ chatAppend: async () => { throw new Error('ipc gone') } })
    const l = link({ kind: 'context-inject', target: 'c', config: { kind: 'context-inject', wrapper: true, pastePointer: true } })
    const out = await runLink(l, { source: text, targetKind: 'chat', targetData: {}, projectRoot: '/project' }, d)
    expect(out.ok).toBe(false)
    expect(out.summary).toContain('link failed:')
  })
})

describe('defaultOutputPath', () => {
  it('sanitizes titles into safe filenames', () => {
    expect(defaultOutputPath('My Agent!')).toBe('.termsprawl/outputs/my-agent.md')
    expect(defaultOutputPath('   ')).toBe('.termsprawl/outputs/output.md')
    expect(defaultOutputPath('???')).toBe('.termsprawl/outputs/output.md')
    expect(defaultOutputPath('Build / Box 2')).toBe('.termsprawl/outputs/build-box-2.md')
  })
})
