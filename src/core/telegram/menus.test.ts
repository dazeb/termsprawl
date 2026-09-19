import { describe, expect, it } from 'vitest'
import { createTelegramMenus } from './menus'
import type { AppAdapter } from './commands'

function adapter(ids: string[]): AppAdapter {
  return {
    listTerminals: () => ids.map(id => ({ id, projectName: 'Work' })),
    listProjects: () => [],
    status: () => ({ version: 'test', projectCount: 1, liveTerminalCount: ids.length }),
    writeTerminal: () => false,
    captureTerminal: () => null
  }
}

describe('terminal menu navigation', () => {
  it('paginates and preserves the chosen action with payloads below 64 bytes', () => {
    const menus = createTelegramMenus()
    const ids = Array.from({ length: 19 }, (_, n) => `terminal-${n}-${'x'.repeat(100)}`)
    const app = adapter(ids)
    const first = menus.render(42, '/peek', app)
    expect(first.text).toContain('1/3')
    const buttons = first.markup.inline_keyboard.flat()
    expect(buttons.filter(b => b.text.startsWith('Work'))).toHaveLength(8)
    for (const button of buttons) expect(Buffer.byteLength(button.callback_data)).toBeLessThanOrEqual(64)
    const next = buttons.find(b => b.text === 'Next')!
    const second = menus.render(42, menus.resolve(42, next.callback_data)!, app)
    expect(second.text).toContain('2/3')
    const selected = second.markup.inline_keyboard[0]![0]!
    expect(menus.resolve(42, selected.callback_data)).toBe(`/peek ${ids[8]}`)
    const previous = second.markup.inline_keyboard.flat().find(b => b.text === 'Previous')!
    expect(menus.render(42, menus.resolve(42, previous.callback_data)!, app).text).toContain('1/3')
  })

  it('handles empty lists, disappearing terminals, and invalidated menus', () => {
    const menus = createTelegramMenus()
    expect(menus.render(42, '/terminals', adapter([])).text).toBe('no live terminals')
    const menu = menus.render(42, '/terminals', adapter(['gone']))
    const token = menu.markup.inline_keyboard[0]![0]!.callback_data
    const target = menus.resolve(42, token)!
    expect(menus.render(42, target, adapter([])).text).toContain('no longer live')
    menus.clear()
    expect(menus.resolve(42, token)).toBeUndefined()
  })
})
