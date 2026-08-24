// Phase 9 — remote file ops over ssh. Controlled remote shell: the local side
// never runs a shell (argv-array to ssh); the remote `sh -c` runs a command we
// build ourselves with every dynamic value fully quoted. TDD on the quoting.
import { describe, it, expect } from 'vitest'
import { shq, remoteFileReadCmd } from './remote-file'

describe('shq', () => {
  it('wraps a simple path in single quotes', () => {
    expect(shq('/srv/a')).toBe("'/srv/a'")
  })

  it('escapes embedded single quotes', () => {
    expect(shq("/srv/it's")).toBe("'/srv/it'\\''s'")
  })
})

describe('remoteFileReadCmd', () => {
  it('builds a POSIX cat command for the remote shell', () => {
    expect(remoteFileReadCmd('/srv/termsprawl.com/index.html')).toBe(
      "cat '/srv/termsprawl.com/index.html'"
    )
  })
})
