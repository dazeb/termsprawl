// Phase 9 — remote git op construction. TDD: the failing tests drive remote-git.ts.
import { describe, it, expect } from 'vitest'
import { toGitResult, remoteGitArgs } from './remote-git'

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
