// Phase 9 — remote git op construction. TDD: the failing tests drive remote-git.ts.
import { describe, it, expect } from 'vitest'
import { toGitResult, remoteGitArgs, parseRemoteCommits } from './remote-git'

describe('toGitResult', () => {
  it('maps ssh output to a GitResult', () => {
    expect(toGitResult(0, 'out', 'err')).toEqual({ code: 0, stdout: 'out', stderr: 'err' })
  })
})

describe('remoteGitArgs', () => {
  it('prepends git -C <path> and disables color without a shell string', () => {
    expect(remoteGitArgs('/srv/repo', ['status', '--porcelain'])).toEqual([
      'git',
      '-C',
      '/srv/repo',
      '-c',
      'color.ui=false',
      'status',
      '--porcelain'
    ])
  })
})

describe('parseRemoteCommits', () => {
  it('parses %h%09%an%09%ad%09%s log lines', () => {
    expect(
      parseRemoteCommits('a1b2c3d\tAlice\t2026-08-27\tfeat: remote git\nf00d\tBob\t2026-08-26\tfix: thing\n')
    ).toEqual([
      { hash: 'a1b2c3d', author: 'Alice', date: '2026-08-27', subject: 'feat: remote git' },
      { hash: 'f00d', author: 'Bob', date: '2026-08-26', subject: 'fix: thing' }
    ])
  })

  it('tolerates empty output and malformed lines', () => {
    expect(parseRemoteCommits('')).toEqual([])
    expect(parseRemoteCommits('garbage\n')).toEqual([{ hash: 'garbage', author: '', date: '', subject: '' }])
  })
})
