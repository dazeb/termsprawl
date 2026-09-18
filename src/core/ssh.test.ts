// Phase 9 — SSH remote transport. TDD: the failing tests drive ssh.ts.
import { describe, it, expect } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseRemote,
  connectionArgs,
  remoteCommand,
  shq,
  sshControlPath,
  sameRemoteHost
} from './ssh'

describe('parseRemote', () => {
  it('parses a bare host (ssh alias)', () => {
    expect(parseRemote('termsprawl-box')).toEqual({ host: 'termsprawl-box' })
  })

  it('parses user@host', () => {
    expect(parseRemote('root@203.0.113.10')).toEqual({
      user: 'root',
      host: '203.0.113.10'
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

describe('control-master multiplexing (connectionArgs opts)', () => {
  it('adds ControlMaster/ControlPath/ControlPersist before the target', () => {
    const args = connectionArgs({ user: 'root', host: 'h' }, { controlPath: '/tmp/ctl-h' })
    expect(args).toContain('ControlMaster=auto')
    expect(args).toContain('ControlPath=/tmp/ctl-h')
    expect(args).toContain('ControlPersist=600')
    // options must come before the target (ssh treats the first non-option as target)
    const targetIdx = args.indexOf('root@h')
    expect(targetIdx).toBeGreaterThan(args.indexOf('ControlPath=/tmp/ctl-h'))
  })

  it('omits control options when no controlPath is given (backward compatible)', () => {
    const args = connectionArgs({ host: 'h' })
    expect(args).not.toContain('ControlMaster=auto')
    expect(args).toEqual([
      '-o',
      'BatchMode=yes',
      '-o',
      'StrictHostKeyChecking=accept-new',
      'h'
    ])
  })
})

describe('sshControlPath', () => {
  it('builds a sanitized per-host socket under userData/ssh and creates the dir', () => {
    const base = mkdtempSync(join(tmpdir(), 'ts-ctl-'))
    const cp = sshControlPath(base, { user: 'root', host: '192.0.2.10' })
    expect(cp).toBe(join(base, 'ssh', 'ctl-root@192.0.2.10'))
    expect(statSync(join(base, 'ssh')).isDirectory()).toBe(true)
  })

  it('sanitizes ports and odd host chars out of the filename', () => {
    const cp = sshControlPath('/tmp/x', { user: 'deploy', host: 'my.host:2222' })
    expect(cp).not.toContain(':')
    expect(cp.startsWith('/tmp/x/ssh/ctl-')).toBe(true)
  })
})

describe('sameRemoteHost', () => {
  it('compares host/user/port but not path', () => {
    expect(sameRemoteHost({ host: 'h' }, { host: 'h' })).toBe(true)
    expect(sameRemoteHost({ user: 'root', host: 'h' }, { host: 'h' })).toBe(true)
    expect(sameRemoteHost({ host: 'h', port: 2222 }, { host: 'h' })).toBe(false)
    expect(sameRemoteHost({ host: 'a' }, { host: 'b' })).toBe(false)
  })
})

describe('runSsh with control path (local ssh round-trip via localhost)', () => {
  it('multiplexes two commands over one ControlMaster socket', () => {
    // localhost ssh with key auth — skip unless we can connect without a prompt
    const probe = spawnSync(
      'ssh',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=3', 'localhost', 'true'],
      { stdio: 'ignore' }
    )
    if (probe.status !== 0) return // no localhost sshd — skip silently
    const base = mkdtempSync(join(tmpdir(), 'ts-ctl-live-'))
    const cp = sshControlPath(base, { host: 'localhost' })
    const first = spawnSync('ssh', [...connectionArgs({ host: 'localhost' }, { controlPath: cp }), "echo one"], {
      encoding: 'utf8'
    })
    const second = spawnSync('ssh', [...connectionArgs({ host: 'localhost' }, { controlPath: cp }), "echo two"], {
      encoding: 'utf8'
    })
    expect(first.status).toBe(0)
    expect(first.stdout.trim()).toBe('one')
    expect(second.status).toBe(0)
    expect(second.stdout.trim()).toBe('two')
    // a master socket now exists (the second call rode it)
    expect(existsSync(cp)).toBe(true)
  }, 20000)
})
