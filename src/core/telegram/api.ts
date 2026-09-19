// Phase 11 — Telegram Bot API client. Electron-free, zero dependencies:
// plain fetch over HTTPS, long-polling getUpdates. The fetch implementation is
// injectable so tests never touch the network.
//
// Clean-room: written fresh for termsprawl (concept from docs/OWN-WORK.md §A);
// nothing copied from the fork or any other project.

const API_BASE = 'https://api.telegram.org'

export type FetchLike = (url: string, init?: {
  method?: string
  headers?: Record<string, string>
  body?: string
  signal?: AbortSignal
}) => Promise<{
  ok: boolean
  status: number
  json(): Promise<unknown>
}>

export interface TelegramApiResult<T> {
  ok: boolean
  result?: T
  error?: string
  /** Telegram error code when the API rejected the call (401 = bad token,
   * 409 = another poller, 400 = bad request, …). */
  errorCode?: number
}

export interface TelegramUpdate {
  update_id: number
  callback_query?: {
    id: string
    from: { id: number }
    data?: string
    message?: { message_id: number; chat: { id: number } }
  }
  message?: {
    chat: { id: number }
    text?: string
    from?: { id: number; username?: string; first_name?: string }
  }
}

export interface InlineKeyboardMarkup {
  inline_keyboard: { text: string; callback_data: string }[][]
}

export interface TelegramUser {
  id: number
  is_bot: boolean
  first_name: string
  username?: string
}

export interface TelegramMessage {
  message_id: number
  chat: { id: number }
  text?: string
}

/** Perform one Telegram Bot API call. GET with query params (getUpdates,
 * getMe) or POST with a JSON body (sendMessage, sendChatAction). Returns a
 * normalized { ok, result | error } shape; never throws on HTTP/API errors. */
export async function telegramRequest<T>(
  token: string,
  method: string,
  params: Record<string, unknown> = {},
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  signal?: AbortSignal
): Promise<TelegramApiResult<T>> {
  const url = `${API_BASE}/bot${token}/${method}`
  try {
    const init: { method?: string; body?: string; headers?: Record<string, string>; signal?: AbortSignal } = {}
    if (Object.keys(params).length > 0) {
      init.method = 'POST'
      init.headers = { 'Content-Type': 'application/json' }
      init.body = JSON.stringify(params)
    }
    if (signal) init.signal = signal
    const res = await fetchImpl(url, init)
    const json = (await res.json()) as {
      ok?: boolean
      result?: T
      description?: string
      error_code?: number
    }
    if (json.ok === false || !res.ok) {
      return {
        ok: false,
        error: json.description ?? `telegram API ${method} failed`,
        errorCode: json.error_code ?? (res.ok ? undefined : res.status)
      }
    }
    return { ok: true, result: json.result }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Minimal long-polling client. Callers own the loop (the bot runtime in
 * main/telegram does); this class is a thin typed wrapper over the API. */
export class TelegramClient {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike
  ) {}

  getMe(signal?: AbortSignal): Promise<TelegramApiResult<TelegramUser>> {
    return telegramRequest<TelegramUser>(this.token, 'getMe', {}, this.fetchImpl, signal)
  }

  /** Drop any webhook so long-polling getUpdates works (409 otherwise). */
  deleteWebhook(signal?: AbortSignal): Promise<TelegramApiResult<boolean>> {
    return telegramRequest<boolean>(this.token, 'deleteWebhook', {}, this.fetchImpl, signal)
  }

  /** Fetch updates after `offset`; pass timeout=20 for long polling. */
  getUpdates(offset: number, timeout = 20, signal?: AbortSignal): Promise<TelegramApiResult<TelegramUpdate[]>> {
    return telegramRequest<TelegramUpdate[]>(
      this.token,
      'getUpdates',
      { offset, timeout, allowed_updates: ['message', 'callback_query'] },
      this.fetchImpl,
      signal
    )
  }

  answerCallbackQuery(id: string, signal?: AbortSignal): Promise<TelegramApiResult<boolean>> {
    return telegramRequest(this.token, 'answerCallbackQuery', { callback_query_id: id }, this.fetchImpl, signal)
  }

  setMyCommands(commands: { command: string; description: string }[], signal?: AbortSignal): Promise<TelegramApiResult<boolean>> {
    return telegramRequest(this.token, 'setMyCommands', { commands }, this.fetchImpl, signal)
  }

  setChatMenuButton(signal?: AbortSignal): Promise<TelegramApiResult<boolean>> {
    return telegramRequest(this.token, 'setChatMenuButton', { menu_button: { type: 'commands' } }, this.fetchImpl, signal)
  }

  sendMessage(chatId: number, text: string, signal?: AbortSignal, replyMarkup?: InlineKeyboardMarkup): Promise<TelegramApiResult<TelegramMessage>> {
    return telegramRequest<TelegramMessage>(
      this.token,
      'sendMessage',
      { chat_id: chatId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) },
      this.fetchImpl,
      signal
    )
  }

  sendChatAction(
    chatId: number,
    action: 'typing' | 'upload_photo' | 'record_video',
    signal?: AbortSignal
  ): Promise<TelegramApiResult<boolean>> {
    return telegramRequest<boolean>(
      this.token,
      'sendChatAction',
      { chat_id: chatId, action },
      this.fetchImpl,
      signal
    )
  }
}
