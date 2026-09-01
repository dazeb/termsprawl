import { describe, expect, it } from 'vitest'
import {
  connectableLinkKinds,
  extractContent,
  linkDefaultConfig,
  validateLink,
  type ExtractDeps,
  type NodeExtractInput
} from './registry'

function deps(overrides: Partial<ExtractDeps> = {}): ExtractDeps {
  return {
    capturePane: async () => 'pane output',
    readFile: async () => 'file content',
    ...overrides
  }
}

function node(overrides: Partial<NodeExtractInput> = {}): NodeExtractInput {
  return {
    nodeId: 'n1',
    nodeKind: 'sticky',
    data: {},
    ...overrides
  }
}

describe('validateLink', () => {
  it('accepts valid source/target pairs', () => {
    expect(validateLink('file-output', 'terminal', 'file')).toBeNull()
    expect(validateLink('file-output', 'sticky', 'file')).toBeNull()
    expect(validateLink('file-output', 'editor', 'file')).toBeNull()
    expect(validateLink('file-output', 'chat', 'file')).toBeNull()
    expect(validateLink('context-inject', 'terminal', 'chat')).toBeNull()
    expect(validateLink('context-inject', 'sticky', 'terminal')).toBeNull()
    expect(validateLink('a2a-peer', 'terminal', 'a2a-peer')).toBeNull()
    expect(validateLink('a2a-peer', 'chat', 'a2a-peer')).toBeNull()
  })

  it('rejects invalid source kinds', () => {
    expect(validateLink('file-output', 'browser', 'file')).toMatch(/source/)
    expect(validateLink('context-inject', 'group', 'chat')).toMatch(/source/)
    expect(validateLink('a2a-peer', 'sticky', 'a2a-peer')).toMatch(/source/)
  })

  it('rejects invalid target kinds', () => {
    expect(validateLink('file-output', 'sticky', 'chat')).toMatch(/target/)
    expect(validateLink('context-inject', 'sticky', 'browser')).toMatch(/target/)
    expect(validateLink('a2a-peer', 'terminal', 'chat')).toMatch(/target/)
  })

  it('rejects unknown link kinds', () => {
    expect(validateLink('nope' as never, 'sticky', 'file')).toMatch(/kind/)
  })
})

describe('connectableLinkKinds', () => {
  it('offers file-output from any linkable source to any node target', () => {
    expect(connectableLinkKinds('terminal', 'sticky')).toEqual(['file-output'])
    expect(connectableLinkKinds('sticky', 'browser')).toEqual(['file-output'])
  })

  it('offers context-inject when the target can receive context', () => {
    expect(connectableLinkKinds('terminal', 'chat')).toEqual(['file-output', 'context-inject'])
    expect(connectableLinkKinds('chat', 'terminal')).toEqual(['file-output', 'context-inject'])
  })

  it('offers nothing for non-linkable sources', () => {
    expect(connectableLinkKinds('browser', 'chat')).toEqual([])
    expect(connectableLinkKinds('group', 'terminal')).toEqual([])
  })
})

describe('linkDefaultConfig', () => {
  it('returns sane defaults per kind', () => {
    expect(linkDefaultConfig('file-output')).toEqual({
      kind: 'file-output',
      path: '',
      mode: 'overwrite',
      header: true
    })
    expect(linkDefaultConfig('context-inject')).toEqual({
      kind: 'context-inject',
      wrapper: true,
      pastePointer: true
    })
    expect(linkDefaultConfig('a2a-peer')).toEqual({
      kind: 'a2a-peer',
      message: 'last-output',
      deliverReply: false
    })
  })
})

describe('extractContent', () => {
  it('extracts sticky text', async () => {
    const out = await extractContent(node({ data: { text: 'hello world' } }), deps())
    expect(out).toEqual({ kind: 'text', text: 'hello world', title: 'sticky' })
  })

  it('reports empty for a blank sticky', async () => {
    const out = await extractContent(node({ data: { text: '   ' } }), deps())
    expect(out).toEqual({ kind: 'empty' })
  })

  it('extracts terminal content via capturePane', async () => {
    const calls: string[] = []
    const out = await extractContent(
      node({ nodeKind: 'terminal', nodeId: 'term-1', data: { title: 'build box' } }),
      deps({ capturePane: async (id) => (calls.push(id), '$ ls\nsrc\n') })
    )
    expect(calls).toEqual(['term-1'])
    expect(out).toEqual({ kind: 'text', text: '$ ls\nsrc\n', title: 'build box' })
  })

  it('reports empty when capturePane returns null or whitespace', async () => {
    expect(
      await extractContent(node({ nodeKind: 'terminal' }), deps({ capturePane: async () => null }))
    ).toEqual({ kind: 'empty' })
    expect(
      await extractContent(node({ nodeKind: 'terminal' }), deps({ capturePane: async () => '  ' }))
    ).toEqual({ kind: 'empty' })
  })

  it('extracts editor content by reading the saved file', async () => {
    const paths: string[] = []
    const out = await extractContent(
      node({ nodeKind: 'editor', data: { path: '/proj/notes/idea.md' } }),
      deps({ readFile: async (p) => (paths.push(p), '# Idea\nbody') })
    )
    expect(paths).toEqual(['/proj/notes/idea.md'])
    expect(out).toEqual({ kind: 'text', text: '# Idea\nbody', title: 'idea.md' })
  })

  it('reports empty for an editor with no path', async () => {
    const out = await extractContent(node({ nodeKind: 'editor', data: {} }), deps())
    expect(out).toEqual({ kind: 'empty' })
  })

  it('serializes chat messages into a conversation transcript', async () => {
    const out = await extractContent(
      node({
        nodeKind: 'chat',
        data: {
          title: 'planning',
          messages: [
            { id: 'm1', role: 'user', content: 'what changed?', ts: 1 },
            { id: 'm2', role: 'assistant', content: 'the registry grew', ts: 2 }
          ]
        }
      }),
      deps()
    )
    expect(out.kind).toBe('conversation')
    if (out.kind === 'conversation') {
      expect(out.title).toBe('planning')
      expect(out.text).toContain('user: what changed?')
      expect(out.text).toContain('assistant: the registry grew')
    }
  })

  it('reports empty for a chat with no messages', async () => {
    const out = await extractContent(node({ nodeKind: 'chat', data: { messages: [] } }), deps())
    expect(out).toEqual({ kind: 'empty' })
  })

  it('reports empty for unknown node kinds and survives throwing deps', async () => {
    expect(await extractContent(node({ nodeKind: 'group' }), deps())).toEqual({ kind: 'empty' })
    expect(
      await extractContent(
        node({ nodeKind: 'terminal' }),
        deps({
          capturePane: async () => {
            throw new Error('pty gone')
          }
        })
      )
    ).toEqual({ kind: 'empty' })
    expect(
      await extractContent(
        node({ nodeKind: 'editor', data: { path: '/x' } }),
        deps({
          readFile: async () => {
            throw new Error('boom')
          }
        })
      )
    ).toEqual({ kind: 'empty' })
  })
})
