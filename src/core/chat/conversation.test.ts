// Tests for the conversation model: message append/patch helpers, slash
// command detection, and capped serialization. Pure unit tests — no IO.

import { describe, expect, it } from 'vitest'
import {
  appendDelta,
  appendMessage,
  appendThinking,
  capConversationMessages,
  createConversation,
  deserializeConversation,
  detectSlashCommand,
  markStopped,
  serializeConversation,
  setUsage,

} from './conversation'

describe('conversation model', () => {
  it('createConversation returns an empty conversation with ids', () => {
    const conv = createConversation()
    expect(conv.id).toMatch(/[0-9a-f-]{36}/)
    expect(conv.messages).toEqual([])
    expect(typeof conv.createdAt).toBe('number')
  })

  it('appendMessage adds a message with id + ts and returns it', () => {
    const conv = createConversation()
    const msg = appendMessage(conv, 'user', 'hello')
    expect(msg.role).toBe('user')
    expect(msg.content).toBe('hello')
    expect(msg.id).toBeTruthy()
    expect(typeof msg.ts).toBe('number')
    expect(conv.messages).toHaveLength(1)
    const second = appendMessage(conv, 'assistant', 'hi')
    expect(second.id).not.toBe(msg.id)
  })

  it('appendDelta appends streamed text to an existing message', () => {
    const conv = createConversation()
    const msg = appendMessage(conv, 'assistant', '')
    appendDelta(conv, msg.id, 'Hel')
    appendDelta(conv, msg.id, 'lo')
    expect(conv.messages[0].content).toBe('Hello')
  })

  it('appendDelta creates the message when missing', () => {
    const conv = createConversation()
    appendDelta(conv, 'stream-1', 'hi')
    expect(conv.messages).toHaveLength(1)
    expect(conv.messages[0].content).toBe('hi')
    expect(conv.messages[0].id).toBe('stream-1')
  })

  it('appendThinking / setUsage / markStopped patch the message', () => {
    const conv = createConversation()
    const msg = appendMessage(conv, 'assistant', '')
    appendThinking(conv, msg.id, 'pondering')
    appendThinking(conv, msg.id, ' more')
    setUsage(conv, msg.id, { inputTokens: 10, outputTokens: 3 }, 'gpt-4o')
    markStopped(conv, msg.id)
    expect(conv.messages[0].thinking).toBe('pondering more')
    expect(conv.messages[0].usage).toEqual({ inputTokens: 10, outputTokens: 3 })
    expect(conv.messages[0].model).toBe('gpt-4o')
    expect(conv.messages[0].stopped).toBe(true)
  })
})

describe('detectSlashCommand', () => {
  it('parses the four known commands', () => {
    expect(detectSlashCommand('/clear')).toEqual({ command: 'clear' })
    expect(detectSlashCommand('/model gpt-4o')).toEqual({ command: 'model', arg: 'gpt-4o' })
    expect(detectSlashCommand('/system be terse')).toEqual({ command: 'system', arg: 'be terse' })
    expect(detectSlashCommand('/cost')).toEqual({ command: 'cost' })
  })

  it('is case-insensitive on the command word', () => {
    expect(detectSlashCommand('/MODEL gpt-4o')).toEqual({ command: 'model', arg: 'gpt-4o' })
    expect(detectSlashCommand('/Clear')).toEqual({ command: 'clear' })
  })

  it('returns null for non-commands and unknown slashes', () => {
    expect(detectSlashCommand('model x')).toBeNull()
    expect(detectSlashCommand('hello /clear')).toBeNull()
    expect(detectSlashCommand('/nope')).toBeNull()
    expect(detectSlashCommand('/')).toBeNull()
  })
})

describe('serialization', () => {
  function sampleConversation() {
    const conv = createConversation()
    appendMessage(conv, 'system', 'be terse')
    appendMessage(conv, 'user', 'q1')
    const a1 = appendMessage(conv, 'assistant', 'a1')
    setUsage(conv, a1.id, { inputTokens: 5, outputTokens: 2 }, 'gpt-4o')
    appendMessage(conv, 'user', 'q2')
    appendMessage(conv, 'assistant', 'a2')
    return conv
  }

  it('round-trips a conversation (tolerating unknown fields)', () => {
    const conv = sampleConversation()
    const blob = serializeConversation(conv)
    const parsed = JSON.parse(blob)
    expect(parsed.v).toBe(1)
    expect(parsed.messages).toHaveLength(5)
    const back = deserializeConversation(blob)
    expect(back.messages.map((m) => [m.role, m.content])).toEqual([
      ['system', 'be terse'],
      ['user', 'q1'],
      ['assistant', 'a1'],
      ['user', 'q2'],
      ['assistant', 'a2']
    ])
    expect(back.messages[2].usage).toEqual({ inputTokens: 5, outputTokens: 2 })
    expect(back.messages[2].model).toBe('gpt-4o')
  })

  it('deserialized messages tolerate unknown fields', () => {
    const blob = JSON.stringify({
      v: 1,
      messages: [
        { id: 'm1', role: 'user', content: 'x', ts: 1, somethingNew: true },
        { id: 'm2', role: 'assistant', content: 'y', ts: 2, brandNew: { a: 1 } }
      ]
    })
    const conv = deserializeConversation(blob)
    expect(conv.messages[0].content).toBe('x')
    expect(conv.messages[1].role).toBe('assistant')
  })

  it('drops oldest user+assistant pairs over the byte cap, keeping system + newest', () => {
    const conv = createConversation()
    appendMessage(conv, 'system', 'sys')
    for (let i = 1; i <= 6; i++) {
      appendMessage(conv, 'user', `u${i}${'x'.repeat(200)}`)
      appendMessage(conv, 'assistant', `a${i}${'x'.repeat(200)}`)
    }
    // Cap small enough to force dropping, big enough for a couple of pairs.
    const blob = serializeConversation(conv, 1400)
    const back = deserializeConversation(blob)
    expect(back.messages[0].role).toBe('system')
    expect(back.messages[0].content).toBe('sys')
    // Newest assistant must survive.
    expect(back.messages[back.messages.length - 1].content).toContain('a6')
    expect(back.messages[back.messages.length - 1].role).toBe('assistant')
    // Pairs were dropped from the OLDEST side: no u1/a1 remnants.
    const contents = back.messages.map((m) => m.content)
    expect(contents.some((c) => c.startsWith('u1'))).toBe(false)
    expect(serializeConversation(conv, 1400).length).toBeLessThanOrEqual(1400)
  })

  it('capConversationMessages leaves messages untouched under the cap', () => {
    const conv = sampleConversation()
    expect(capConversationMessages(conv.messages)).toBe(conv.messages)
  })

  it('capConversationMessages drops oldest pairs without a leading system message', () => {
    const conv = createConversation()
    for (let i = 1; i <= 6; i++) {
      appendMessage(conv, 'user', `u${i}${'x'.repeat(200)}`)
      appendMessage(conv, 'assistant', `a${i}${'x'.repeat(200)}`)
    }
    const capped = capConversationMessages(conv.messages, 1400)
    expect(JSON.stringify({ v: 1, messages: capped }).length).toBeLessThanOrEqual(1400)
    expect(capped[capped.length - 1].content).toContain('a6')
    expect(capped.some((m) => m.content.startsWith('u1'))).toBe(false)
  })

  it('throws TypeError on garbage input', () => {
    expect(() => deserializeConversation('not json')).toThrow(TypeError)
    expect(() => deserializeConversation('{"v":1}')).toThrow(TypeError)
    expect(() => deserializeConversation('{"v":1,"messages":"nope"}')).toThrow(TypeError)
  })
})
