// Phase 9 — remote terminal transport argv. TDD: the failing tests drive
// remote-pty.ts.
import { describe, it, expect } from 'vitest'
import { remoteTmuxSpawnArgv } from './remote-pty'

describe('remoteTmuxSpawnArgv', () => {
  it('builds an interactive ssh -tt argv for a remote tmux session', () => {
    expect(remoteTmuxSpawnArgv({ user: 'root', host: 'h' }, 'ts-a1', '/bin/bash')).toEqual([
      '-tt',
      '-o',
      'BatchMode=yes',
      '-o',
      'StrictHostKeyChecking=accept-new',
      'root@h',
      'tmux new-session -A -D -s ts-a1 -- /bin/bash'
    ])
  })

  it('adds -p <port> when the remote specifies one', () => {
    const argv = remoteTmuxSpawnArgv({ host: 'h', port: 2222 }, 'ts-a1', '/bin/zsh')
    expect(argv).toContain('-p')
    expect(argv).toContain('2222')
    expect(argv[argv.length - 1]).toBe('tmux new-session -A -D -s ts-a1 -- /bin/zsh')
  })
})
