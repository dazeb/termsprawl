// Phase 11 — Telegram Bot API client. TDD: fake fetch, no network.
import { describe, it, expect } from 'vitest'
import { telegramRequest, TelegramClient, type FetchLike } from './api'

function fakeFetch(
  respond: (url: string, init?: { method?: string; body?: string }) => {
    ok: boolean
    status: number
    json: unknown
  }
): { fetchImpl: FetchLike; calls: { url: string; init?: { method?: string; body?: string } }[] } {
  const calls: { url: string; init?: { method?: string; body?: string } }[] = []
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init })
    const res = respond(url, init)
    return { ok: res.ok, status: res.status, json: async () => res.json }
  }
  return { fetchImpl, calls }
}

const TOKEN = '123:test-token'

describe('telegramRequest', () => {
  it('hits the bot API URL with the token and no body for GET-ish calls', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ ok: true, status: 200, json: { ok: true, result: { id: 1 } } }))
    const res = await telegramRequest(TOKEN, 'getMe', {}, fetchImpl)
    expect(res.ok).toBe(true)
    expect(calls[0]?.url).toBe(`https://api.telegram.org/bot${TOKEN}/getMe`)
    expect(calls[0]?.init?.method).toBeUndefined()
  })

  it('POSTs params as JSON for sendMessage', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ ok: true, status: 200, json: { ok: true, result: { message_id: 7 } } }))
    const res = await telegramRequest(TOKEN, 'sendMessage', { chat_id: 42, text: 'hi' }, fetchImpl)
    expect(res.ok).toBe(true)
    expect(calls[0]?.init?.method).toBe('POST')
    expect(JSON.parse(calls[0]?.init?.body ?? '{}')).toEqual({ chat_id: 42, text: 'hi' })
  })

  it('normalizes API errors (ok:false) into { ok:false, error, errorCode }', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      ok: false,
      status: 401,
      json: { ok: false, error_code: 401, description: 'Unauthorized' }
    }))
    const res = await telegramRequest(TOKEN, 'getMe', {}, fetchImpl)
    expect(res).toEqual({ ok: false, error: 'Unauthorized', errorCode: 401 })
  })

  it('never throws on network failure — returns the error', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error('ECONNREFUSED')
    }
    const res = await telegramRequest(TOKEN, 'getMe', {}, fetchImpl)
    expect(res.ok).toBe(false)
    expect(res.error).toContain('ECONNREFUSED')
  })
})

describe('TelegramClient', () => {
  it('getMe/getUpdates/sendMessage/sendChatAction/deleteWebhook call the right methods', async () => {
    const { fetchImpl, calls } = fakeFetch((url) => {
      if (url.endsWith('/getMe')) return { ok: true, status: 200, json: { ok: true, result: { id: 9, is_bot: true, first_name: 'b' } } }
      if (url.endsWith('/getUpdates')) return { ok: true, status: 200, json: { ok: true, result: [{ update_id: 1 }] } }
      if (url.endsWith('/deleteWebhook')) return { ok: true, status: 200, json: { ok: true, result: true } }
      return { ok: true, status: 200, json: { ok: true, result: { message_id: 1 } } }
    })
    const client = new TelegramClient(TOKEN, fetchImpl)

    const me = await client.getMe()
    expect(me.ok && me.result?.first_name).toBe('b')

    const updates = await client.getUpdates(5, 20)
    expect(updates.ok && (updates.result as unknown[]).length).toBe(1)
    // offset + timeout must be in the POST body
    const updCall = calls.find((c) => c.url.endsWith('/getUpdates'))
    expect(JSON.parse(updCall?.init?.body ?? '{}')).toEqual({ offset: 5, timeout: 20 })

    await client.deleteWebhook()
    expect(calls.some((c) => c.url.endsWith('/deleteWebhook'))).toBe(true)

    const sent = await client.sendMessage(42, 'hello')
    expect(sent.ok && sent.result?.message_id).toBe(1)
    const sendCall = calls.find((c) => c.url.endsWith('/sendMessage'))
    expect(JSON.parse(sendCall?.init?.body ?? '{}')).toEqual({ chat_id: 42, text: 'hello' })

    await client.sendChatAction(42, 'typing')
    expect(calls.some((c) => c.url.endsWith('/sendChatAction'))).toBe(true)
  })
})
