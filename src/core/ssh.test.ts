// Phase 9 — SSH remote transport. TDD: the failing tests drive ssh.ts.
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { parseRemote, connectionArgs, remoteCommand, shq } from './ssh'

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

describe('remoteCommand', () => {
  it('joins argv into ONE quoted remote shell command', () => {
    expect(remoteCommand(['git', '-C', '/srv/repo', 'status'])).toBe(
      "'git' '-C' '/srv/repo' 'status'"
    )
  })

  it('keeps multi-word values (commit messages) intact for the remote shell', () => {
    const cmd = remoteCommand(['git', '-C', '/srv/repo', 'commit', '-m', 'second commit from live test'])
    expect(cmd).toContain("'second commit from live test'")
    // round-trips through a POSIX shell back to the original argv (echo joins with spaces)
    const out = execFileSync('/bin/sh', ['-c', 'echo ' + cmd], { encoding: 'utf8' })
    expect(out).toBe('git -C /srv/repo commit -m second commit from live test\n')
  })

  it('escapes embedded single quotes', () => {
    expect(shq("it's")).toBe("'it'\\''s'")
    expect(remoteCommand(['echo', "it's"])).toBe("'echo' 'it'\\''s'")
  })
})
