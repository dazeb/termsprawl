import { describe, expect, it } from 'vitest'
import {
  buildMessageSend,
  extractResponseText,
  isRpcResponse,
  parseAgentCard,
  parseRpcError
} from './protocol'

describe('buildMessageSend', () => {
  it('builds a valid A2A message/send request', () => {
    const body = buildMessageSend('hello agent')
    expect(body.jsonrpc).toBe('2.0')
    expect(body.method).toBe('message/send')
    expect(body.params.message.role).toBe('user')
    expect(body.params.message.kind).toBe('message')
    expect(body.params.message.parts).toEqual([{ kind: 'text', text: 'hello agent' }])
    expect(body.params.message.messageId.startsWith('tsprawl-')).toBe(true)
  })

  it('generates unique messageIds and honors explicit ids', () => {
    const a = buildMessageSend('one')
    const b = buildMessageSend('two')
    expect(a.params.message.messageId).not.toBe(b.params.message.messageId)
    expect(buildMessageSend('three', { id: 42 }).id).toBe(42)
    expect(a.id).toBe(1)
  })
})

describe('parseAgentCard', () => {
  it('accepts a valid card', () => {
    const card = parseAgentCard({
      name: 'termsprawl agent',
      url: 'http://127.0.0.1:9910/',
      description: 'a canvas agent',
      version: '1.0.0',
      skills: [{ id: 'code', name: 'coding' }]
    })
    expect(card).toEqual({
      name: 'termsprawl agent',
      url: 'http://127.0.0.1:9910/',
      description: 'a canvas agent',
      version: '1.0.0',
      skills: [{ id: 'code', name: 'coding' }]
    })
  })

  it('accepts a minimal card (name only) and tolerates non-string optionals', () => {
    expect(parseAgentCard({ name: 'x' })).toEqual({ name: 'x' })
  })

  it('rejects junk', () => {
    expect(parseAgentCard(null)).toBeNull()
    expect(parseAgentCard(42)).toBeNull()
    expect(parseAgentCard('card')).toBeNull()
    expect(parseAgentCard({})).toBeNull()
    expect(parseAgentCard({ name: '' })).toBeNull()
    expect(parseAgentCard({ name: 5 })).toBeNull()
    expect(parseAgentCard({ name: 'x', skills: 'nope' })).toBeNull()
    expect(parseAgentCard({ name: 'x', skills: [42] })).toBeNull()
  })
})

describe('extractResponseText', () => {
  it('extracts a single text part from a Message result', () => {
    const out = extractResponseText({
      kind: 'message',
      role: 'agent',
      messageId: 'm1',
      parts: [{ kind: 'text', text: 'A2A-OK' }]
    })
    expect(out).toEqual({ ok: true, text: 'A2A-OK' })
  })

  it('joins multiple text parts with newlines and skips non-text parts', () => {
    const out = extractResponseText({
      parts: [
        { kind: 'text', text: 'line one' },
        { kind: 'file', name: 'x.txt' },
        { kind: 'text', text: 'line two' }
      ]
    })
    expect(out).toEqual({ ok: true, text: 'line one\nline two' })
  })

  it('summarizes a Task result', () => {
    expect(
      extractResponseText({ kind: 'task', id: 't-9', status: { state: 'working' } })
    ).toEqual({ ok: true, task: { id: 't-9', state: 'working' } })
    expect(extractResponseText({ kind: 'task', id: 't-9' })).toEqual({
      ok: true,
      task: { id: 't-9', state: 'unknown' }
    })
  })

  it('fails honestly on junk or text-less results', () => {
    expect(extractResponseText(null)).toEqual({ ok: false, error: 'response contained no text parts' })
    expect(extractResponseText({})).toEqual({ ok: false, error: 'response contained no text parts' })
    expect(extractResponseText({ parts: [{ kind: 'text' }] })).toEqual({
      ok: false,
      error: 'response contained no text parts'
    })
  })
})

describe('parseRpcError', () => {
  it('formats a JSON-RPC error object', () => {
    expect(parseRpcError({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'method not found' } })).toBe(
      'RPC error -32601: method not found'
    )
  })

  it('returns null when there is no error', () => {
    expect(parseRpcError({ jsonrpc: '2.0', id: 1, result: {} })).toBeNull()
    expect(parseRpcError(null)).toBeNull()
    expect(parseRpcError({ error: { code: 1 } })).toBeNull()
    expect(parseRpcError({ error: { message: 'no code' } })).toBeNull()
  })
})

describe('isRpcResponse', () => {
  it('detects well-formed responses', () => {
    expect(isRpcResponse({ jsonrpc: '2.0', id: 1, result: {} })).toBe(true)
    expect(isRpcResponse({ jsonrpc: '2.0', id: 1, error: { code: -1, message: 'x' } })).toBe(true)
  })

  it('rejects junk', () => {
    expect(isRpcResponse({})).toBe(false)
    expect(isRpcResponse(null)).toBe(false)
    expect(isRpcResponse({ jsonrpc: '1.0', result: {} })).toBe(false)
    expect(isRpcResponse({ jsonrpc: '2.0' })).toBe(false)
  })
})
