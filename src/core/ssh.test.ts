// Phase 9 — SSH remote transport. TDD: the failing tests drive ssh.ts.
import { describe, it, expect } from 'vitest'
import { parseRemote, connectionArgs } from './ssh'

describe('parseRemote', () => {
  it('parses a bare host (ssh alias)', () => {
    expect(parseRemote('termsprawl-box')).toEqual({ host: 'termsprawl-box' })
  })

  it('parses user@host', () => {
    expect(parseRemote('root@178.104.6.193')).toEqual({
      user: 'root',
      host: '178.104.6.193'
    })
  })

  it('parses user@host:port', () => {
    expect(parseRemote('deploy@h:2222')).toEqual({ user: 'deploy', host: 'h', port: 2222 })
  })

  it('does not mistake a trailing non-numeric segment for a port (scp-style host:path)', () => {
    expect(parseRemote('h:/srv/git/x.git')).toEqual({ host: 'h:/srv/git/x.git' })
    expect(parseRemote('h:/srv/git/x.git').port).toBeUndefined()
  })
})

describe('connectionArgs', () => {
  it('builds ssh argv for user@host', () => {
    expect(connectionArgs({ user: 'root', host: 'h' })).toEqual([
      '-o',
      'BatchMode=yes',
      '-o',
      'StrictHostKeyChecking=accept-new',
      'root@h'
    ])
  })

  it('adds -p <port> when a port is set', () => {
    expect(connectionArgs({ host: 'h', port: 2222 })).toEqual([
      '-o',
      'BatchMode=yes',
      '-o',
      'StrictHostKeyChecking=accept-new',
      '-p',
      '2222',
      'h'
    ])
  })
})
