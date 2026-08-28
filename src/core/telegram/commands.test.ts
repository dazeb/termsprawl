// Phase 11 — Telegram command surface. TDD: fake adapter, no bot/pty/network.
import { describe, it, expect } from 'vitest'
import {
  parseCommand,
  truncate,
  formatProjects,
  formatTerminals,
  formatHelp,
  handleCommand,
  resolveTerminalId,
  type AppAdapter,
  type BotProject,
  type BotTerminal
} from './commands'

function fakeAdapter(overrides: Partial<AppAdapter> = {}): AppAdapter & { written: { id: string; text: string }[] } {
  const written: { id: string; text: string }[] = []
  const projects: BotProject[] = [
    { id: 'p1', name: 'termsprawl', location: '/home/dazeb/work', liveTerminalCount: 1 },
    { id: 'p2', name: 'lxc', location: 'root@192.168.8.221:/srv/x', liveTerminalCount: 0 }
  ]
  const terminals: BotTerminal[] = [
    { id: 'term-abc', projectName: 'termsprawl' },
    { id: 'term-xyz', projectName: 'lxc' }
  ]
  return {
    written,
    status: () => ({ version: '0.9.1', projectCount: 2, liveTerminalCount: 2 }),
    listProjects: () => projects,
    listTerminals: () => terminals,
    writeTerminal: (id, text) => {
      const known = terminals.some((t) => t.id === id)
      if (known) written.push({ id, text })
      return known
    },
    captureTerminal: (id) => (id === 'term-abc' ? 'hello from the shell\nprompt$ ' : null),
    ...overrides
  }
}

function ctx(chatId: number, text: string, allowedChatIds: string[] = ['42'], paired: number[] = []): {
  ctx: Parameters<typeof handleCommand>[0]
  pairedLog: number[]
} {
  const pairedLog: number[] = []
  return {
    pairedLog,
    ctx: {
      chatId,
      text,
      allowedChatIds,
      pairChat: (id) => pairedLog.push(id)
    }
  }
}

describe('parseCommand', () => {
  it('parses /name and args', () => {
    expect(parseCommand('/send abc hello world')).toEqual({ name: 'send', args: ['abc', 'hello', 'world'] })
    expect(parseCommand('/projects')).toEqual({ name: 'projects', args: [] })
    expect(parseCommand('  /help  ')).toEqual({ name: 'help', args: [] })
  })

  it('returns null for non-command text', () => {
    expect(parseCommand('just typing')).toBeNull()
    expect(parseCommand('')).toBeNull()
  })
})

describe('truncate', () => {
  it('keeps short text, caps long text with a note', () => {
    expect(truncate('hi', 10)).toBe('hi')
    const long = 'x'.repeat(100)
    const out = truncate(long, 30)
    expect(out.length).toBeLessThan(30)
    expect(out).toContain('(+')
  })
})

describe('formatProjects / formatTerminals', () => {
  it('renders projects with location and terminal counts', () => {
    expect(formatProjects(fakeAdapter().listProjects())).toBe(
      '1. termsprawl — /home/dazeb/work (1 terminal)\n2. lxc — root@192.168.8.221:/srv/x (0 terminals)'
    )
  })

  it('renders terminals with owning project', () => {
    expect(formatTerminals(fakeAdapter().listTerminals())).toBe(
      '• term-abc — termsprawl\n• term-xyz — lxc'
    )
  })

  it('handles empty lists', () => {
    expect(formatProjects([])).toBe('no projects yet')
    expect(formatTerminals([])).toBe('no live terminals')
  })
})

describe('pairing gate', () => {
  it('denies a chat not on a non-empty allowlist', () => {
    const { ctx: c } = ctx(7, '/projects', ['42'])
    const res = handleCommand(c, fakeAdapter())
    expect(res.replies[0]).toContain('not paired')
  })

  it('pairs the first chat via /start on an empty allowlist', () => {
    const { ctx: c, pairedLog } = ctx(7, '/start', [])
    const res = handleCommand(c, fakeAdapter())
    expect(pairedLog).toEqual([7])
    expect(res.replies[0]).toContain('paired')
  })

  it('does not pair on empty allowlist until /start', () => {
    const { ctx: c, pairedLog } = ctx(7, '/projects', [])
    const res = handleCommand(c, fakeAdapter())
    expect(pairedLog).toEqual([])
    expect(res.replies[0]).toContain('say /start')
  })
})

describe('handlers', () => {
  it('/help lists the commands', () => {
    const { ctx: c } = ctx(42, '/help')
    const res = handleCommand(c, fakeAdapter())
    expect(res.replies[0]).toContain('/send')
    expect(res.replies[0]).toContain('/attach')
    expect(formatHelp()).toContain('/projects')
  })

  it('/projects lists projects through the adapter', () => {
    const { ctx: c } = ctx(42, '/projects')
    const res = handleCommand(c, fakeAdapter())
    expect(res.replies[0]).toContain('termsprawl')
    expect(res.replies[0]).toContain('root@192.168.8.221')
  })

  it('/terminals lists live terminals', () => {
    const { ctx: c } = ctx(42, '/terminals')
    expect(handleCommand(c, fakeAdapter()).replies[0]).toContain('term-abc')
  })

  it('/send writes text + Enter to the resolved terminal', () => {
    const adapter = fakeAdapter()
    const { ctx: c } = ctx(42, '/send term-abc ls -la')
    const res = handleCommand(c, adapter)
    expect(res.replies[0]).toBe('sent to term-abc')
    expect(adapter.written).toEqual([{ id: 'term-abc', text: 'ls -la' }])
  })

  it('/send resolves a unique id prefix', () => {
    const adapter = fakeAdapter()
    const { ctx: c } = ctx(42, '/send term-xyz pwd')
    const res = handleCommand(c, adapter)
    expect(res.replies[0]).toBe('sent to term-xyz')
    expect(adapter.written[0]?.id).toBe('term-xyz')
  })

  it('/send rejects unknown terminals and missing args', () => {
    const { ctx: c1 } = ctx(42, '/send nope hi')
    expect(handleCommand(c1, fakeAdapter()).replies[0]).toContain('no terminal matching')
    const { ctx: c2 } = ctx(42, '/send term-abc')
    expect(handleCommand(c2, fakeAdapter()).replies[0]).toContain('usage')
  })

  it('/peek returns captured output, truncated', () => {
    const { ctx: c } = ctx(42, '/peek term-abc')
    const res = handleCommand(c, fakeAdapter())
    expect(res.replies[0]).toContain('hello from the shell')
    const { ctx: c2 } = ctx(42, '/peek term-xyz')
    expect(handleCommand(c2, fakeAdapter()).replies[0]).toContain('no captured output')
  })

  it('/attach sets the attach marker and /detach clears it', () => {
    const { ctx: c } = ctx(42, '/attach term-abc')
    const res = handleCommand(c, fakeAdapter())
    expect(res.attach).toEqual({ terminalId: 'term-abc' })
    expect(res.replies[0]).toContain('streaming')

    const { ctx: c2 } = ctx(42, '/detach')
    expect(handleCommand(c2, fakeAdapter()).detach).toBe(true)
  })

  it('/status reports version and counts', () => {
    const { ctx: c } = ctx(42, '/status')
    expect(handleCommand(c, fakeAdapter()).replies[0]).toContain('v0.9.1')
    expect(handleCommand(c, fakeAdapter()).replies[0]).toContain('2 projects, 2 live terminals')
  })

  it('unknown commands get a help hint', () => {
    const { ctx: c } = ctx(42, '/frobnicate')
    expect(handleCommand(c, fakeAdapter()).replies[0]).toContain('unknown command')
  })
})

describe('resolveTerminalId', () => {
  it('exact match wins, unique prefix resolves, ambiguous prefix returns null', () => {
    const adapter = fakeAdapter()
    expect(resolveTerminalId(adapter, 'term-abc')).toBe('term-abc')
    expect(resolveTerminalId(adapter, 'term-a')).toBe('term-abc') // unique prefix
    expect(resolveTerminalId(adapter, 'term-')).toBeNull() // ambiguous
    expect(resolveTerminalId(adapter, 'zzz')).toBeNull()
  })
})
