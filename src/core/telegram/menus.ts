import { randomUUID } from 'node:crypto'
import type { InlineKeyboardMarkup } from './api'
import { parseCommand, type AppAdapter } from './commands'

type Button = InlineKeyboardMarkup['inline_keyboard'][number][number]
const MENU_TTL_MS = 10 * 60 * 1000
const PAGE_SIZE = 8

/** Opaque, chat-bound references keep arbitrary node ids out of the 64-byte
 * callback payload. Old menus expire and the cache has a fixed upper bound. */
export function createTelegramMenus() {
  const actions = new Map<string, { chatId: number; command: string; expires: number }>()
  return {
    resolve(chatId: number, token: string): string | undefined {
      const action = actions.get(token)
      return action?.chatId === chatId && action.expires > Date.now() ? action.command : undefined
    },
    clear() { actions.clear() },
    render(chatId: number, command: string, adapter: AppAdapter): { text?: string; markup: InlineKeyboardMarkup } {
      for (const [token, action] of actions) if (action.expires <= Date.now()) actions.delete(token)
      const button = (text: string, target: string): Button => {
        while (actions.size >= 2000) actions.delete(actions.keys().next().value!)
        const token = randomUUID()
        actions.set(token, { chatId, command: target, expires: Date.now() + MENU_TTL_MS })
        return { text, callback_data: token }
      }
      const parsed = parseCommand(command)
      const name = parsed?.name
      const args = parsed?.args ?? []
      const rows: Button[][] = []
      let text: string | undefined
      if (name === 'terminals' || name === 'pick' || (['peek', 'attach', 'send'].includes(name ?? '') && !args[0])) {
        const action = name === 'pick' ? args[0]! : name === 'terminals' ? 'terminal' : name!
        const terminals = adapter.listTerminals()
        const requested = name === 'pick' ? Number(args[1]) || 0 : 0
        const page = Math.max(0, Math.min(Math.floor(requested), Math.max(0, Math.ceil(terminals.length / PAGE_SIZE) - 1)))
        text = terminals.length ? `Choose a terminal (${page + 1}/${Math.ceil(terminals.length / PAGE_SIZE)}):` : 'no live terminals'
        for (const terminal of terminals.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
          rows.push([button(`${terminal.projectName} · ${terminal.id}`.slice(0, 80), `/${action} ${terminal.id}`)])
        }
        const pages: Button[] = []
        if (page > 0) pages.push(button('Previous', `/pick ${action} ${page - 1}`))
        if ((page + 1) * PAGE_SIZE < terminals.length) pages.push(button('Next', `/pick ${action} ${page + 1}`))
        if (pages.length) rows.push(pages)
      } else if (name === 'terminal') {
        const id = args[0]!
        if (adapter.listTerminals().some(t => t.id === id)) {
          text = `Terminal ${id} — choose an action:`
          rows.push([button('Read output', `/peek ${id}`), button('Stream output', `/attach ${id}`)])
          rows.push([button('Send text', `/send ${id}`)])
        } else text = 'This terminal is no longer live.'
      }
      rows.push([button('Projects', '/projects'), button('Terminals', '/terminals')])
      rows.push([button('Status', '/status'), button('Stop stream', '/detach')])
      rows.push([button('Menu', '/menu'), button('Help', '/help'), button('Cancel', '/cancel')])
      return { text, markup: { inline_keyboard: rows } }
    }
  }
}
