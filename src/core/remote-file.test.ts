// Phase 9 — remote file ops over ssh. Controlled remote shell: the local side
// never runs a shell (argv-array to ssh); the remote `sh -c` runs a command we
// build ourselves with every dynamic value fully quoted. TDD on the quoting.
import { describe, it, expect } from 'vitest'
import { shq, remoteFileReadCmd, remoteListDirCmd, parseRemoteDirListing } from './remote-file'

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

describe('remoteListDirCmd', () => {
  it('builds a guarded find -printf listing with MISSING/NOTDIR markers', () => {
    const cmd = remoteListDirCmd('/srv/repo')
    expect(cmd).toContain("if [ ! -e '/srv/repo' ]; then echo MISSING >&2; exit 1; fi")
    expect(cmd).toContain("if [ ! -d '/srv/repo' ]; then echo NOTDIR >&2; exit 2; fi")
    expect(cmd).toContain("find '/srv/repo' -maxdepth 1 -mindepth 1 -printf '%y\\t%f\\n'")
  })

  it('quotes paths with spaces', () => {
    expect(remoteListDirCmd('/srv/my repo')).toContain("find '/srv/my repo'")
  })
})

describe('parseRemoteDirListing', () => {
  it('parses find -printf output, skipping dotfiles, node_modules, and .git', () => {
    const entries = parseRemoteDirListing(
      "d\tsrc\nd\tnode_modules\nd\t.git\nf\tREADME.md\nf\t.prettierrc\n",
      '/srv/repo'
    )
    expect(entries).toEqual([
      { name: 'src', path: '/srv/repo/src', kind: 'dir' },
      { name: 'README.md', path: '/srv/repo/README.md', kind: 'file' }
    ])
  })

  it('sorts dirs first then by name', () => {
    const entries = parseRemoteDirListing('f\tb.txt\nf\ta.txt\nd\tzdir\n', '/r')
    expect(entries.map((e) => e.name)).toEqual(['zdir', 'a.txt', 'b.txt'])
  })
})
