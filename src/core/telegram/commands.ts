// Phase 11 — Telegram command surface. Pure: parses updates, formats replies,
// and dispatches through an AppAdapter so it is fully unit-testable without a
// bot, a pty, or a network. The runtime (main/telegram/bot.ts) supplies the
// adapter + persists pairing.
//
// Command set (docs/OWN-WORK.md §A concept): /start /help /projects /terminals
// /send <id> <text> /peek <id> /attach <id> /detach /status.

import { pairingDecision, type PairingDecision } from './pairing'

/** Published automatically when the configured bot starts. */
export const BOT_COMMANDS = [
  { command: 'start', description: 'Pair this chat and open the menu' },
  { command: 'menu', description: 'Open the navigation buttons' },
  { command: 'projects', description: 'List projects' },
  { command: 'terminals', description: 'Choose a live terminal' },
  { command: 'peek', description: 'Read terminal output' },
  { command: 'attach', description: 'Stream terminal output for five minutes' },
  { command: 'send', description: 'Send text and Enter to a terminal' },
  { command: 'detach', description: 'Stop streaming output' },
  { command: 'cancel', description: 'Cancel pending terminal input' },
  { command: 'status', description: 'Show app version and counts' },
  { command: 'help', description: 'Show command help' }
]

export const MAX_REPLY_CHARS = 4096 // Telegram hard limit

// ---------------------------------------------------------------------------
// Adapter — everything the commands need from the app (implemented in main).
// ---------------------------------------------------------------------------

export interface BotProject {
  id: string
  name: string
  /** Local cwd or a remote label like `root@host:/path`. */
  location: string
  liveTerminalCount: number
}

export interface BotTerminal {
  id: string
  projectName: string
}

export interface BotStatus {
  version: string
  projectCount: number
  liveTerminalCount: number
}

export interface AppAdapter {
  status(): BotStatus
  listProjects(): BotProject[]
  listTerminals(): BotTerminal[]
  /** Write `text` + Enter to the terminal. Returns false for an unknown id. */
  writeTerminal(id: string, text: string): boolean
  /** Recent pane output, or null when the terminal is gone/has no output. */
  captureTerminal(id: string): string | null
}

// ---------------------------------------------------------------------------
// Parsing + formatting (pure)
// ---------------------------------------------------------------------------

export interface ParsedCommand {
  name: string
  args: string[]
}

/** `/send abc hello world` → { name: 'send', args: ['abc', 'hello', 'world'] }. */
export function parseCommand(text: string): ParsedCommand | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return null
  const [head, ...args] = trimmed.slice(1).split(/\s+/)
  if (!head) return null
  return { name: head.toLowerCase(), args }
}

/** Cap a reply at Telegram's limit with a truncation note. */
export function truncate(text: string, max = MAX_REPLY_CHARS): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max - 24)
  return `${cut}\n…(+${text.length - cut.length} chars)`
}

/** Clean terminal pane output for a chat message: strip ANSI escape sequences
 * (colors/cursor ops), drop other control chars (keep \n and \t), trim trailing
 * whitespace per line, and collapse runs of blank lines — so an /peek or
 * /attach pane reads as tidy text instead of raw terminal noise. */
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001B\[[0-9;?]*[A-Za-z]|\u001B\][^\u0007]*\u0007|\u001B[()][A-Z0-9]/g
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

export function sanitizePane(text: string): string {
  const stripped = text.replace(ANSI_RE, '').replace(CONTROL_RE, '')
  const collapsed: string[] = []
  for (const line of stripped.split('\n')) {
    const trimmed = line.replace(/\s+$/g, '')
    if (trimmed === '' && collapsed[collapsed.length - 1] === '') continue
    collapsed.push(trimmed)
  }
  return collapsed.join('\n').trim()
}

export function formatProjects(projects: BotProject[]): string {
  if (projects.length === 0) return 'no projects yet'
  return projects
    .map((p, i) => `${i + 1}. ${p.name} — ${p.location} (${p.liveTerminalCount} terminal${p.liveTerminalCount === 1 ? '' : 's'})`)
    .join('\n')
}

export function formatTerminals(terminals: BotTerminal[]): string {
  if (terminals.length === 0) return 'no live terminals'
  return terminals
    .map((t) => `• ${t.id} — ${t.projectName}`)
    .join('\n')
}

export function formatHelp(): string {
  return [
    'termsprawl bot — control the app from your phone',
    '',
    '/menu — open clickable navigation buttons',
    '/projects — list projects',
    '/terminals — list live terminals',
    '/send <id> <text> — type into a terminal (Enter included)',
    '/peek <id> — show a terminal\u2019s recent output',
    '/attach <id> — stream a terminal\u2019s output (auto-stops after 5 min)',
    '/detach — stop streaming',
    '/cancel — cancel pending terminal input',
    '/status — app version + counts',
    '/help — this list'
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export interface CommandContext {
  chatId: number
  /** Raw message text (may not start with /). */
  text: string
  allowedChatIds: string[]
  /** Persist this chat as a paired owner (runtime side). */
  pairChat(chatId: number): void
}

export interface CommandResult {
  replies: string[]
  /** When set, the runtime starts streaming this terminal to this chat. */
  attach?: { terminalId: string }
  /** When true, the runtime stops any stream for this chat. */
  detach?: boolean
}

const NOT_PAIRED =
  'this chat is not paired with termsprawl. On the desktop app, add this chat id to Settings → Telegram → allowed chats.'

/** Resolve a terminal id from an exact match or a unique prefix (phone-typing
 * friendly). Returns null when ambiguous or missing. */
export function resolveTerminalId(adapter: AppAdapter, arg: string): string | null {
  const ids = adapter.listTerminals().map((t) => t.id)
  const exact = ids.find((id) => id === arg)
  if (exact) return exact
  const prefixed = ids.filter((id) => id.startsWith(arg))
  return prefixed.length === 1 ? (prefixed[0] ?? null) : null
}

/** Handle one message and produce reply texts (+ attach/detach markers). */
export function handleCommand(ctx: CommandContext, adapter: AppAdapter): CommandResult {
  const decision: PairingDecision = pairingDecision(ctx.chatId, ctx.allowedChatIds)
  const parsed = parseCommand(ctx.text)
  const name = parsed?.name ?? ''

  // Pairing gate: first /start on an empty allowlist becomes the owner.
  if (decision === 'denied') return { replies: [NOT_PAIRED] }
  if (decision === 'pair-me' && name !== 'start') {
    return { replies: ['say /start to pair this chat with termsprawl'] }
  }
  if (decision === 'pair-me' && name === 'start') {
    ctx.pairChat(ctx.chatId)
    return {
      replies: [`paired — this chat can now control termsprawl.\n\n${formatHelp()}`]
    }
  }

  switch (name) {
    case 'start':
    case 'menu':
    case 'help':
      return { replies: [formatHelp()] }

    case 'projects': {
      const projects = adapter.listProjects()
      return { replies: [truncate(formatProjects(projects))] }
    }

    case 'terminals': {
      const terminals = adapter.listTerminals()
      return { replies: [truncate(formatTerminals(terminals))] }
    }

    case 'send': {
      const [idArg, ...rest] = parsed?.args ?? []
      if (!idArg || rest.length === 0) {
        return { replies: ['usage: /send <terminal id> <text>'] }
      }
      const id = resolveTerminalId(adapter, idArg)
      if (!id) return { replies: [`no terminal matching "${idArg}"`] }
      const text = rest.join(' ')
      const ok = adapter.writeTerminal(id, text)
      return ok
        ? { replies: [`sent to ${id}`] }
        : { replies: [`terminal ${id} is gone`] }
    }

    case 'peek': {
      const [idArg] = parsed?.args ?? []
      if (!idArg) return { replies: ['usage: /peek <terminal id>'] }
      const id = resolveTerminalId(adapter, idArg)
      if (!id) return { replies: [`no terminal matching "${idArg}"`] }
      const pane = adapter.captureTerminal(id)
      if (pane === null || pane.trim().length === 0) {
        return { replies: [`terminal ${id} has no captured output`] }
      }
      return { replies: [truncate(`terminal ${id}:\n\n${sanitizePane(pane)}`)] }
    }

    case 'attach': {
      const [idArg] = parsed?.args ?? []
      if (!idArg) return { replies: ['usage: /attach <terminal id>'] }
      const id = resolveTerminalId(adapter, idArg)
      if (!id) return { replies: [`no terminal matching "${idArg}"`] }
      const pane = adapter.captureTerminal(id)
      const first =
        pane !== null && pane.trim().length > 0
          ? truncate(`streaming ${id} — here is the current pane:\n\n${sanitizePane(pane)}`)
          : `streaming ${id} — waiting for output…`
      return { replies: [first], attach: { terminalId: id } }
    }

    case 'cancel':
      return { replies: ['cancelled pending input'] }

    case 'detach':
      return { replies: ['stopped streaming'], detach: true }

    case 'status': {
      const s = adapter.status()
      return {
        replies: [
          `termsprawl v${s.version} — ${s.projectCount} project${s.projectCount === 1 ? '' : 's'}, ` +
            `${s.liveTerminalCount} live terminal${s.liveTerminalCount === 1 ? '' : 's'}`
        ]
      }
    }

    default:
      return { replies: ['unknown command — /help for the list'] }
  }
}
