// Phase 11 — Telegram bot runtime (main process). Owns the long-poll loop,
// the AppAdapter wiring (workspaceStore + ptyManager + tmux capture), pairing
// persistence, and /attach output streaming. Electron-free itself — all
// dependencies are injected, so it is unit-testable with a fake fetch.
//
// Start/stop is driven by AppSettings.telegram (enabled + token + allowlist)
// via syncTelegramBot() in main/index.ts. Token source: env
// TERMSPRAWL_TELEGRAM_TOKEN wins over settings.telegram.token — never in repo.

import {
  TelegramClient,
  type FetchLike,
  type TelegramUpdate
} from '../../core/telegram/api'
import {
  handleCommand,
  truncate,
  type AppAdapter,
  type BotProject,
  type BotTerminal
} from '../../core/telegram/commands'
import { addPairedChat } from '../../core/telegram/pairing'
import { remoteLabel } from '../../shared/remote-project'
import type { WorkspaceStore } from '../../core/workspace-store'
import type { PtyManager } from '../../core/pty-manager'
import type { ProjectMeta } from '../../shared/types'

const POLL_TIMEOUT_S = 20
const NETWORK_BACKOFF_MS = 3000
const ATTACH_INTERVAL_MS = 2000
const ATTACH_MAX_MS = 5 * 60 * 1000

export interface TelegramBotDeps {
  token: string
  /** Current allowlist (read fresh each update so pairing persists). */
  allowedChatIds(): string[]
  /** Persist a new allowlist (pairing + settings panel). */
  saveAllowedChatIds(ids: string[]): void
  workspaceStore: WorkspaceStore
  ptyManager: PtyManager
  version(): string
  log(msg: string): void
  fetchImpl?: FetchLike
}

export interface TelegramBot {
  start(): Promise<void>
  stop(): void
  isRunning(): boolean
  /** Process one update (also used by tests + synthetic drives). */
  handleUpdate(update: TelegramUpdate): Promise<void>
}

interface Streamer {
  terminalId: string
  lastText: string
  startedAt: number
  timer: ReturnType<typeof setInterval>
}

export function createTelegramBot(deps: TelegramBotDeps): TelegramBot {
  const client = new TelegramClient(deps.token, deps.fetchImpl ?? (fetch as unknown as FetchLike))
  const streamers = new Map<number, Streamer>()

  let running = false
  let abort: AbortController | null = null
  let offset = 0

  // -------------------------------------------------------------------------
  // AppAdapter — the bridge between commands and the real app surfaces.
  // -------------------------------------------------------------------------

  const projectNameById = (): Map<string, string> => {
    const map = new Map<string, string>()
    for (const p of deps.workspaceStore.snapshot().index.projects) map.set(p.id, p.name)
    return map
  }

  const adapter: AppAdapter = {
    status: () => {
      const projects = deps.workspaceStore.snapshot().index.projects
      return {
        version: deps.version(),
        projectCount: projects.length,
        liveTerminalCount: deps.ptyManager.liveSessionIds().length
      }
    },
    listProjects: () => {
      const projects: ProjectMeta[] = deps.workspaceStore.snapshot().index.projects
      const names = projectNameById()
      return projects.map((p): BotProject => {
        const location = p.remote ? remoteLabel(p.remote) : p.cwd ?? 'no folder'
        const suffix = p.closed ? ' (closed)' : ''
        return {
          id: p.id,
          name: `${p.name}${suffix}`,
          location,
          liveTerminalCount: deps.ptyManager.sessionIdsForProject(p.id).length
        }
      })
    },
    listTerminals: () => {
      const names = projectNameById()
      return deps.ptyManager.liveSessionIds().map((id): BotTerminal => {
        const projectId = deps.workspaceStore.snapshot().index.projects.find((p) =>
          deps.ptyManager.sessionIdsForProject(p.id).includes(id)
        )?.id
        return { id, projectName: projectId ? (names.get(projectId) ?? 'project') : 'unowned' }
      })
    },
    writeTerminal: (id, text) => {
      if (!deps.ptyManager.has(id)) return false
      deps.ptyManager.write(id, `${text}\r`)
      return true
    },
    captureTerminal: (id) => deps.ptyManager.capturePane(id)
  }

  // -------------------------------------------------------------------------
  // Update handling
  // -------------------------------------------------------------------------

  async function handleUpdate(update: TelegramUpdate): Promise<void> {
    const msg = update.message
    if (!msg || typeof msg.text !== 'string' || msg.text.length === 0) return
    const chatId = msg.chat.id

    const result = handleCommand(
      {
        chatId,
        text: msg.text,
        allowedChatIds: deps.allowedChatIds(),
        pairChat: (id) => {
          deps.saveAllowedChatIds(addPairedChat(deps.allowedChatIds(), id))
          deps.log(`telegram: paired chat ${id}`)
        }
      },
      adapter
    )

    // One message per command: join the reply fragments (multi-line blocks) and
    // drop empties, so a chat never gets a blank bubble or split fragments.
    const text = result.replies.filter((r) => r.trim().length > 0).join('\n')
    if (text.trim().length > 0) {
      await client.sendMessage(chatId, text)
    }

    if (result.attach) {
      startStream(chatId, result.attach.terminalId)
    } else if (result.detach) {
      stopStream(chatId)
    }
  }

  // -------------------------------------------------------------------------
  // /attach streaming — poll the pane, send diffs, auto-stop after 5 min.
  // -------------------------------------------------------------------------

  function startStream(chatId: number, terminalId: string): void {
    stopStream(chatId)
    let lastText = ''
    const timer = setInterval(() => {
      const pane = adapter.captureTerminal(terminalId)
      const streamer = streamers.get(chatId)
      if (!streamer) return
      if (Date.now() - streamer.startedAt > ATTACH_MAX_MS) {
        void client.sendMessage(chatId, `auto-detached from ${terminalId} (5 min)`)
        stopStream(chatId)
        return
      }
      if (pane === null || pane.length === 0) {
        if (!deps.ptyManager.has(terminalId)) {
          void client.sendMessage(chatId, `terminal ${terminalId} ended`)
          stopStream(chatId)
        }
        return
      }
      if (pane !== lastText) {
        lastText = pane
        void client.sendMessage(chatId, truncate(pane))
      }
    }, ATTACH_INTERVAL_MS)
    streamers.set(chatId, { terminalId, lastText, startedAt: Date.now(), timer })
  }

  function stopStream(chatId: number): void {
    const streamer = streamers.get(chatId)
    if (streamer) {
      clearInterval(streamer.timer)
      streamers.delete(chatId)
    }
  }

  // -------------------------------------------------------------------------
  // Long-poll loop
  // -------------------------------------------------------------------------

  async function pollLoop(): Promise<void> {
    while (running && abort) {
      const res = await client.getUpdates(offset, POLL_TIMEOUT_S, abort.signal)
      if (!running) break
      if (res.ok && res.result) {
        for (const update of res.result) {
          if (update.update_id >= offset) offset = update.update_id + 1
          await handleUpdate(update)
        }
        continue
      }
      // API rejected us:
      if (res.errorCode === 401) {
        deps.log('telegram: bad token (401) — bot stopped')
        running = false
        break
      }
      if (res.errorCode === 409) {
        deps.log('telegram: conflict (409) — another poller is running; bot stopped')
        running = false
        break
      }
      // Transient network/API failure: back off and retry.
      deps.log(`telegram: poll failed (${res.error ?? res.errorCode ?? 'unknown'}) — retrying`)
      await new Promise((resolve) => setTimeout(resolve, NETWORK_BACKOFF_MS))
    }
  }

  return {
    async start() {
      if (running) return
      abort = new AbortController()
      running = true
      const me = await client.getMe(abort.signal)
      if (!me.ok) {
        deps.log(`telegram: getMe failed (${me.error ?? 'unknown'}) — bot not started`)
        running = false
        abort = null
        return
      }
      await client.deleteWebhook(abort.signal)
      deps.log(`telegram: bot @${me.result?.username ?? '?'} online (long-polling)`)
      void pollLoop()
    },

    stop() {
      if (!running) return
      running = false
      abort?.abort()
      abort = null
      for (const chatId of [...streamers.keys()]) stopStream(chatId)
      deps.log('telegram: bot stopped')
    },

    isRunning: () => running,

    handleUpdate
  }
}
