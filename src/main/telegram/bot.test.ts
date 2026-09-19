// Phase 11 — Telegram bot runtime. Fake fetch + fake store/pty: no network, no
// electron, no real pty. Exercised through handleUpdate (the same path the
// long-poll loop calls), plus the loop's 401/409 stop behavior via start().
import { describe, it, expect, vi } from 'vitest'
import { createTelegramBot, type TelegramBotDeps } from './bot'
import type { FetchLike } from '../../core/telegram/api'
import type { WorkspaceStore } from '../../core/workspace-store'
import type { PtyManager } from '../../core/pty-manager'

// ------------------------------------------------ fake store/pty -----------
function fakeStore(): Pick<WorkspaceStore, 'snapshot'> {
  return {
    snapshot: () => ({
      index: {
        projects: [
          { id: 'p1', name: 'termsprawl', cwd: '/home/dev/work', closed: false },
          { id: 'p2', name: 'remote', cwd: null, closed: false, remote: { user: 'root', host: '192.0.2.10', path: '/srv/x' } }
        ] as never,
        version: 1 as never
      },
      projects: {}
    })
  }
}

function fakePty(): Pick<PtyManager, 'liveSessionIds' | 'sessionIdsForProject' | 'has' | 'write' | 'capturePane'> {
  const sessions = new Map<string, string>() // id -> projectId
  sessions.set('term-a', 'p1')
  const written: { id: string; text: string }[] = []
  const result: Pick<PtyManager, 'liveSessionIds' | 'sessionIdsForProject' | 'has' | 'write' | 'capturePane'> = {
    liveSessionIds: () => [...sessions.keys()],
    sessionIdsForProject: (projectId: string) =>
      [...sessions.entries()].filter(([, p]) => p === projectId).map(([id]) => id),
    has: (id: string) => sessions.has(id),
    write: (id: string, text: string) => written.push({ id, text }),
    capturePane: (id: string) => (id === 'term-a' ? 'pane output line 1\nprompt$ ' : null)
  }
  return result
}

// ------------------------------------------------ fake fetch driver --------
function makeFetchRoute(sent: { chatId: number; text: string }[]): { fetchImpl: FetchLike } {
  const fetchImpl: FetchLike = async (url, init) => {
    const method = (init?.body ? JSON.parse(init.body as string) : {}) as Record<string, unknown>
    if (url.includes('/getMe')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { id: 1, is_bot: true, first_name: 'term', username: 'termsprawl_bot' } }) }
    }
    if (url.includes('/deleteWebhook')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, result: true }) }
    }
    if (url.includes('/getUpdates')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, result: [] }) }
    }
    if (url.includes('/sendMessage')) {
      sent.push({ chatId: method.chat_id as number, text: method.text as string })
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) }
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, result: true }) }
  }
  return { fetchImpl }
}

function makeBot(overrides: Partial<TelegramBotDeps> = {}) {
  const sent: { chatId: number; text: string }[] = []
  const fetchRoute = makeFetchRoute(sent)
  const logs: string[] = []
  const tags: string[] = ['42'] // default allowlist so command tests run; pairing tests override to []
  const deps: TelegramBotDeps = {
    token: '123:test',
    allowedChatIds: () => [...tags],
    saveAllowedChatIds: (ids) => tags.splice(0, tags.length, ...ids),
    workspaceStore: fakeStore() as never,
    ptyManager: fakePty() as never,
    version: () => '0.9.1',
    log: (m) => logs.push(m),
    fetchImpl: fetchRoute.fetchImpl,
    ...overrides
  }
  return { bot: createTelegramBot(deps), sent, logs, tags }
}

function upd(text: string, chatId = 42): Parameters<ReturnType<typeof makeBot>['bot']['handleUpdate']>[0] {
  return { update_id: 1, message: { chat: { id: chatId }, text, from: { id: chatId } } }
}

describe('telegram bot runtime — handleUpdate', () => {
  it('replies to /projects with the real workspace', async () => {
    const { bot, sent } = makeBot()
    await bot.handleUpdate(upd('/projects', 42))
    expect(sent.length).toBe(1)
    expect(sent[0]?.text).toContain('termsprawl')
    expect(sent[0]?.text).toContain('root@192.0.2.10') // remote label
    expect(sent[0]?.text).toContain('remote')
  })

  it('/start on an empty allowlist persists the pairing', async () => {
    const { bot, tags, sent } = makeBot({ allowedChatIds: () => [], saveAllowedChatIds: (ids) => tags.splice(0, tags.length, ...ids) })
    await bot.handleUpdate(upd('/start', 7))
    expect(tags).toEqual(['7'])
    // ONE message with the help folded in — no blank bubble, no split fragments.
    expect(sent.length).toBe(1)
    expect(sent[0]?.text).toContain('paired')
    expect(sent[0]?.text).toContain('/projects')
    expect(sent[0]?.text).not.toEqual('')
  })

  it('denies non-paired chats', async () => {
    const { bot, sent } = makeBot({ allowedChatIds: () => ['99'] })
    await bot.handleUpdate(upd('/projects', 7))
    expect(sent[0]?.text).toContain('not paired')
  })
  it('/send writes to the real pty manager', async () => {
    const { bot, sent } = makeBot()
    await bot.handleUpdate(upd('/send term-a ls -la', 42))
    expect(sent[0]?.text).toBe('sent to term-a')
  })

  it('/peek returns captured pane output', async () => {
    const { bot, sent } = makeBot()
    await bot.handleUpdate(upd('/peek term-a', 42))
    expect(sent[0]?.text).toContain('pane output line 1')
  })

  it('/attach starts a stream and sends the current pane once', async () => {
    const { bot, sent } = makeBot()
    await bot.handleUpdate(upd('/attach term-a', 42))
    expect(sent[0]?.text).toContain('streaming term-a')
    expect(sent[0]?.text).toContain('pane output line 1')
  })

  it('/detach stops streaming (no error, empty replies are fine)', async () => {
    const { bot, sent } = makeBot()
    await bot.handleUpdate(upd('/attach term-a', 42))
    await bot.handleUpdate(upd('/detach', 42))
    expect(sent.some((s) => s.text === 'stopped streaming')).toBe(true)
  })
})

describe('telegram bot runtime — lifecycle', () => {
  it('start() gets the bot and begins polling with no error', async () => {
    const { bot, logs } = makeBot()
    await bot.start()
    expect(bot.isRunning()).toBe(true)
    expect(logs.some((l) => l.includes('online'))).toBe(true)
    bot.stop()
    expect(bot.isRunning()).toBe(false)
  })

  it('start() does not run when getMe fails (bad token)', async () => {
    const failFetch: FetchLike = async (url) => {
      if (url.includes('/getMe')) {
        return { ok: false, status: 401, json: async () => ({ ok: false, error_code: 401, description: 'Unauthorized' }) }
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, result: [] }) }
    }
    const { bot, logs } = makeBot({ fetchImpl: failFetch })
    await bot.start()
    expect(bot.isRunning()).toBe(false)
    expect(logs.some((l) => l.includes('getMe failed'))).toBe(true)
  })

  it('start() aborts a hung getMe after the timeout guard instead of hanging', async () => {
    const hangingFetch: FetchLike = async (url, init) => {
      if (url.includes('/getMe')) {
        // never resolves unless aborted
        await new Promise((resolve) => init?.signal?.addEventListener('abort', resolve))
        return { ok: false, status: 408, json: async () => ({ ok: false, description: 'aborted' }) }
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, result: [] }) }
    }
    const { bot, logs } = makeBot({ fetchImpl: hangingFetch })
    const startedAt = Date.now()
    await bot.start()
    expect(bot.isRunning()).toBe(false)
    expect(Date.now() - startedAt).toBeLessThan(30000) // aborted, not timed out at outer level
    expect(logs.some((l) => l.includes('getMe timed out'))).toBe(true)
  }, 20000)

  it('stop() halts an in-flight poll via abort', async () => {
    let released = false
    const hangingFetch: FetchLike = async (url, init) => {
      if (url.includes('/getUpdates')) {
        await new Promise((resolve) => {
          init?.signal?.addEventListener('abort', () => resolve(undefined))
          setTimeout(() => { released = true; resolve(undefined) }, 5000)
        })
        if (init?.signal?.aborted) {
          return { ok: false, status: 408, json: async () => ({ ok: false, description: 'aborted' }) }
        }
        return { ok: true, status: 200, json: async () => ({ ok: true, result: [] }) }
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, result: [] }) }
    }
    const { bot, logs } = makeBot({ fetchImpl: hangingFetch })
    await bot.start()
    expect(bot.isRunning()).toBe(true)
    bot.stop() // should abort promptly (not wait 5s)
    expect(bot.isRunning()).toBe(false)
    expect(released).toBe(false) // the poll was aborted, not timed out
  })
})

describe('Telegram command menu setup', () => {
  it('registers commands and the menu button before polling', async () => {
    const calls: { method: string; body: Record<string, unknown> }[] = []
    const fetchImpl: FetchLike = async (url, init) => {
      const method = url.split('/').pop()!
      calls.push({ method, body: JSON.parse(init?.body ?? '{}') })
      return { ok: true, status: 200, json: async () => ({ ok: true, result: method === 'getMe' ? { username: 'test_bot' } : [] }) }
    }
    const { bot } = makeBot({ fetchImpl })
    await bot.start()
    bot.stop()
    expect(calls.find(c => c.method === 'setMyCommands')?.body.commands).toEqual(expect.arrayContaining([
      { command: 'menu', description: expect.any(String) },
      { command: 'send', description: expect.any(String) },
      { command: 'cancel', description: expect.any(String) }
    ]))
    expect(calls.find(c => c.method === 'setChatMenuButton')?.body).toEqual({ menu_button: { type: 'commands' } })
    expect(calls.find(c => c.method === 'getUpdates')?.body.allowed_updates).toEqual(['message', 'callback_query'])
  })
})

function menuBot(failPrompt = false) {
  const requests: { method: string; body: any }[] = []
  const route = makeFetchRoute([])
  const pty = fakePty()
  const write = vi.spyOn(pty, 'write')
  const tags = ['42']
  const setup = makeBot({
    ptyManager: pty as never,
    allowedChatIds: () => tags,
    fetchImpl: async (url, init) => {
      requests.push({ method: url.split('/').pop()!, body: JSON.parse(init?.body ?? '{}') })
      if (failPrompt && url.endsWith('/sendMessage') && init?.body?.includes('next message')) {
        return { ok: false, status: 400, json: async () => ({ ok: false, error_code: 400 }) }
      }
      return route.fetchImpl(url, init)
    }
  })
  const last = () => requests.filter(r => r.method === 'sendMessage').at(-1)!.body
  const button = (label: string) => {
    const buttons = last().reply_markup?.inline_keyboard.flat() ?? []
    const found = buttons.find((b: any) => b.text.includes(label))
    expect(found, `button ${label}`).toBeDefined()
    return found.callback_data as string
  }
  const click = (data: string, chatId = 42, sender = chatId) => setup.bot.handleUpdate({
    update_id: 2, callback_query: { id: 'callback-1', from: { id: sender }, data, message: { message_id: 1, chat: { id: chatId } } }
  } as never)
  return { ...setup, requests, last, button, click, write, tags, pty }
}

it('navigates from the main menu to a terminal and reads its output', async () => {
  const m = menuBot()
  await m.bot.handleUpdate(upd('/menu'))
  await m.click(m.button('Terminals'))
  await m.click(m.button('term-a'))
  await m.click(m.button('Read output'))
  expect(m.last().text).toContain('pane output line 1')
  expect(m.requests.some(r => r.method === 'answerCallbackQuery')).toBe(true)
  await m.click(m.button('Menu'))
  expect(m.button('Projects')).toBeTruthy()
})

it('guides send input, preserves multiline text, and consumes it only once', async () => {
  const m = menuBot()
  await m.bot.handleUpdate(upd('/send'))
  await m.click(m.button('term-a'))
  expect(m.last().text).toContain('next message')
  await m.bot.handleUpdate(upd('printf "hi"\n  echo done'))
  expect(m.write).toHaveBeenCalledExactlyOnceWith('term-a', 'printf "hi"\n  echo done\r')
  await m.bot.handleUpdate(upd('another message'))
  expect(m.write).toHaveBeenCalledTimes(1)
})

it('cancels pending input when navigating and rejects another sender', async () => {
  const m = menuBot()
  await m.bot.handleUpdate(upd('/send term-a'))
  await m.bot.handleUpdate({ ...upd('unrelated'), message: { chat: { id: 42 }, from: { id: 99 }, text: 'unrelated' } })
  expect(m.write).not.toHaveBeenCalled()
  await m.click(m.button('Cancel'))
  await m.bot.handleUpdate(upd('do not execute'))
  expect(m.write).not.toHaveBeenCalled()
})

it('rejects foreign, revoked, unknown and expired menu callbacks', async () => {
  const m = menuBot()
  await m.bot.handleUpdate(upd('/menu'))
  const token = m.button('Terminals')
  m.tags.push('99')
  await m.click(token, 99)
  expect(m.last().text).toContain('expired')
  m.tags.splice(0, 1)
  await m.click(token)
  expect(m.last().text).toContain('not paired')
  m.tags.push('42')
  await m.click('forged-token')
  expect(m.last().text).toContain('expired')
  const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60 * 1000)
  try {
    await m.click(token)
    expect(m.last().text).toContain('expired')
  } finally { now.mockRestore() }
  expect(m.write).not.toHaveBeenCalled()
})

it('does not send expired input or write after access is revoked', async () => {
  const m = menuBot()
  await m.bot.handleUpdate(upd('/send term-a'))
  const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 6 * 60 * 1000)
  try {
    await m.bot.handleUpdate(upd('too late'))
    expect(m.last().text).toContain('expired')
  } finally { now.mockRestore() }
  await m.bot.handleUpdate(upd('/send term-a'))
  m.tags.splice(0, 1, '99')
  await m.bot.handleUpdate(upd('revoked'))
  expect(m.write).not.toHaveBeenCalled()
})

it('stops a stream when its chat is removed from the allowlist', async () => {
  vi.useFakeTimers()
  try {
    const m = menuBot()
    await m.bot.handleUpdate(upd('/attach term-a'))
    m.tags.splice(0, 1, '99')
    const count = m.requests.length
    await vi.advanceTimersByTimeAsync(2500)
    expect(m.requests).toHaveLength(count)
  } finally { vi.useRealTimers() }
})


it('does not arm terminal input when Telegram rejects the prompt', async () => {
  const m = menuBot(true)
  await m.bot.handleUpdate(upd('/send term-a'))
  await m.bot.handleUpdate(upd('this must not run'))
  expect(m.write).not.toHaveBeenCalled()
})


it('does not reinterpret a disappeared button target as a terminal prefix', async () => {
  const m = menuBot()
  await m.bot.handleUpdate(upd('/send'))
  const token = m.button('term-a')
  vi.spyOn(m.pty, 'liveSessionIds').mockReturnValue(['term-ab'])
  vi.spyOn(m.pty, 'has').mockImplementation(id => id === 'term-ab')
  await m.click(token)
  expect(m.last().text).toContain('no longer live')
  await m.bot.handleUpdate(upd('must not execute'))
  expect(m.write).not.toHaveBeenCalled()
})
