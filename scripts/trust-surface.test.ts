// Trust-surface contract for the public repository.
//
// Guards the reviewer-facing documents (SECURITY/CONTRIBUTING/GOVERNANCE/…),
// the maturity wording, the honesty rules (self-audits are not independent
// audits, no revenue claims, no absolute originality claims), the absence of
// GitHub workflow files, the removal of machine-specific infrastructure
// details, and the package metadata. Offline only: no network, no builds.
//
// Runs with the normal suite (`pnpm test`).
import { existsSync, readFileSync, statSync } from 'node:fs'
import { execSync, spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf8')
}

const REQUIRED_FILES = [
  'SECURITY.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'GOVERNANCE.md',
  'ROADMAP.md',
  'FUNDING.md',
  'CHANGELOG.md',
  'docs/PROJECT-HEALTH.md',
  'docs/VERIFICATION.md',
  'docs/media/termsprawl-canvas.png',
  '.github/ISSUE_TEMPLATE/bug_report.yml',
  '.github/ISSUE_TEMPLATE/feature_request.yml',
  '.github/ISSUE_TEMPLATE/config.yml',
  '.github/PULL_REQUEST_TEMPLATE.md',
  '.github/CODEOWNERS'
] as const

describe('required trust documents', () => {
  it.each(REQUIRED_FILES)('%s exists and is non-empty', (rel) => {
    const path = resolve(ROOT, rel)
    expect(existsSync(path), `${rel} is missing`).toBe(true)
    expect(statSync(path).size, `${rel} is empty`).toBeGreaterThan(0)
  })
})

describe('CI surface', () => {
  it('has no GitHub Actions workflow directory', () => {
    expect(existsSync(resolve(ROOT, '.github/workflows'))).toBe(false)
  })

  it('has no FUNDING.yml without a real funding destination', () => {
    expect(existsSync(resolve(ROOT, '.github/FUNDING.yml'))).toBe(false)
  })
})

describe('maturity wording', () => {
  const MATURITY_FILES = [
    'README.md',
    'ROADMAP.md',
    'SECURITY.md',
    'FUNDING.md',
    'docs/PROJECT-HEALTH.md',
    'docs/VERIFICATION.md'
  ] as const

  it.each(MATURITY_FILES)('%s states pre-1.0 status and not feature-completeness', (rel) => {
    const text = read(rel)
    expect(text).toMatch(/pre-1\.0/i)
    expect(text, `${rel} still claims feature-completeness`).not.toMatch(/feature[-\s]complete/i)
    expect(text, `${rel} claims production stability`).not.toMatch(/production[-\s]ready|stable release/i)
  })

  it('README advertises the shipped status, the full agent list, and browser sizing honestly', () => {
    const readme = read('README.md')
    expect(readme).toContain('Pre-1.0 · actively maintained')
    expect(readme).toContain('OpenCode')
    expect(readme, 'stale compact-size browser claim').not.toMatch(/capped at a compact size/i)
    // Line wrapping must not make these assertions brittle.
    const flattened = readme.replace(/\s+/g, ' ')
    expect(flattened).toMatch(/user-resizable/i)
    expect(flattened).toContain('no artificial maximum')
  })
})

describe('honesty rules', () => {
  it('describes the published audits as maintainer self-audits', () => {
    for (const rel of ['README.md', 'docs/PROJECT-HEALTH.md', 'docs/VERIFICATION.md']) {
      expect(read(rel), `${rel} must label the audits as self-audits`).toMatch(/self-audit/i)
    }
    for (const rel of ['README.md', 'docs/PROJECT-HEALTH.md']) {
      expect(read(rel), `${rel} must state that no independent assessment has been done`).toMatch(
        /no independent/i
      )
    }
  })

  it('never claims revenue or paying customers, and describes hosted services as preview/test mode', () => {
    const funding = read('FUNDING.md')
    expect(funding).toMatch(/no revenue/i)
    expect(funding).toMatch(/test[-\s]?mode/i)
    expect(funding).not.toMatch(/\$\s?\d/)
  })

  it('makes no absolute originality claim', () => {
    const ABSOLUTE_CLAIMS = [/100% (our )?own code/i, /zero code/i, /shares no code/i, /nothing in this repo is copied/i]
    for (const rel of ['README.md', 'AGENTS.md', 'PLAN.md', 'HERMES.md', 'docs/VERIFICATION.md']) {
      const text = read(rel)
      for (const claim of ABSOLUTE_CLAIMS) {
        expect(text, `${rel} contains an absolute originality claim (${claim})`).not.toMatch(claim)
      }
    }
  })

  it('documents the automated similarity screen as a heuristic with limits', () => {
    const verification = read('docs/VERIFICATION.md')
    expect(verification).toMatch(/heuristic/i)
    expect(verification).toMatch(/not .{0,24}legal/i)
  })

  it('never claims public code scanning, SBOM, signing, or provenance', () => {
    const health = read('docs/PROJECT-HEALTH.md')
    expect(health).toMatch(/no public/i)
    expect(health).toMatch(/SBOM/i)
    expect(health).toMatch(/signed releases|release signing/i)
  })

  it('labels each published audit as a maintainer self-review inside the file', () => {
    for (const rel of ['docs/AUDIT-2026-08-29.md', 'docs/AUDIT-2026-09-13.md']) {
      const text = read(rel)
      expect(text, `${rel} must label itself a maintainer self-review`).toMatch(
        /maintainer self-(?:review|audit)/i
      )
      expect(text, `${rel} must say it is not an independent assessment`).toMatch(
        /not an independent/i
      )
    }
  })
})

describe('documented gate lists mirror scripts/verify.sh', () => {
  // scripts/verify.sh is the one executable gate list. Every documented copy
  // (prose, numbered list, code comments, the Python constant) must name the
  // same gates in the same order. Adding, removing, or reordering a gate in
  // the script fails here until every copy is updated — and a documented gate
  // the script does not run fails too. That is what makes the copies safe:
  // none of them is a second source of truth, and none can drift silently.
  //
  // The script's structure is the contract: each gate is an
  // `echo "==> verify: <name>"` line followed by the command it runs. Deriving
  // the list from those markers (rather than from command prefixes) means any
  // command kind is captured, and the extra assertion below rejects a command
  // line that was slipped in without the marker.
  const VERIFY = read('scripts/verify.sh')
  const SCRIPT_GATES: string[] = []
  const MARKERS_WITHOUT_COMMAND: string[] = []
  {
    const lines = VERIFY.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const marker = lines[i].match(/^\s*echo "==> verify: (.+)"\s*$/)
      if (!marker || /all gates passed/.test(marker[1])) continue
      const command = lines.slice(i + 1).find((line) => line.trim() !== '')
      if (command === undefined) MARKERS_WITHOUT_COMMAND.push(marker[1])
      else SCRIPT_GATES.push(command.trim())
    }
  }

  const GATE_ALIASES: Array<[RegExp, string]> = [
    [/^(?:pnpm run typecheck|typecheck)\b/, 'pnpm run typecheck'],
    [/^(?:pnpm run build:server|server(?: edition)? build)\b/i, 'pnpm run build:server'],
    [/^(?:pnpm run build|desktop build)\b/, 'pnpm run build'],
    [
      /^(?:python3 scripts\/release-safety\.test\.py|release-safety)\b/,
      'python3 scripts/release-safety.test.py'
    ],
    [/^(?:pnpm test|tests?|vitest)\b/, 'pnpm test']
  ]

  function normaliseGate(item: string, where: string): string {
    const cleaned = item.replace(/[`*]/g, '').replace(/^#\s*/, '').trim()
    for (const [pattern, gate] of GATE_ALIASES) if (pattern.test(cleaned)) return gate
    throw new Error(
      `${where}: unrecognised gate "${cleaned}" — it is not a gate scripts/verify.sh runs; ` +
        'update the documented list to match the script'
    )
  }

  /** Arrow chains that start at a typecheck gate, e.g. `typecheck → … → tests`. */
  function arrowGateLists(text: string): string[][] {
    // Markdown and shell-comment lists wrap across lines; join them first.
    const flat = text.replace(/\r/g, '').replace(/\n[ \t]*#?[ \t]*/g, ' ')
    const lists: string[][] = []
    const pattern = /(pnpm run typecheck|typecheck)((?:\s*(?:→|->)\s*[^→,.;()]+)+)/g
    let match: RegExpExecArray | null
    while ((match = pattern.exec(flat)) !== null) {
      const items = match[2]
        .split(/→|->/)
        .map((item) => item.trim())
        .filter((item) => item !== '')
      lists.push([match[1], ...items])
    }
    return lists
  }

  /** The numbered, backticked gate list in CONTRIBUTING.md. */
  function numberedGateList(text: string): string[][] {
    const commands = [...text.matchAll(/^\d+\.\s+`([^`]+)`\s*$/gm)].map((m) => m[1])
    return commands.length > 0 ? [commands] : []
  }

  /** The `GATES` constant in scripts/release-safety.test.py. */
  function pythonGateList(text: string): string[][] {
    const start = text.indexOf('GATES = [')
    const end = text.indexOf(']', start)
    if (start === -1 || end === -1) return []
    return [[...text.slice(start, end).matchAll(/'([^']+)'/g)].map((m) => m[1])]
  }

  const DOCUMENTS: Array<{ file: string; extract: (text: string) => string[][] }> = [
    { file: 'CONTRIBUTING.md', extract: numberedGateList },
    { file: 'AGENTS.md', extract: arrowGateLists },
    { file: 'README.md', extract: arrowGateLists },
    { file: '.github/PULL_REQUEST_TEMPLATE.md', extract: arrowGateLists },
    { file: 'docs/PROJECT-HEALTH.md', extract: arrowGateLists },
    { file: 'docs/VERIFICATION.md', extract: arrowGateLists },
    { file: '.gitea/workflows/ci.yml', extract: arrowGateLists },
    { file: 'scripts/release-safety.test.py', extract: pythonGateList }
  ]

  it('parses a non-empty gate list from scripts/verify.sh', () => {
    expect(SCRIPT_GATES.length, 'no gates parsed from scripts/verify.sh').toBeGreaterThan(0)
    expect(MARKERS_WITHOUT_COMMAND, 'a gate marker has no command below it').toEqual([])
  })

  it('scripts/verify.sh declares every command it runs with a gate marker', () => {
    const commandLike = VERIFY.split('\n')
      .map((line) => line.trim())
      .filter((line) => /^(?:pnpm|python3|node|bash|\.\/)/.test(line) && !line.startsWith('#'))
    expect(commandLike.filter((line) => !SCRIPT_GATES.includes(line))).toEqual([])
    expect(commandLike).toEqual(SCRIPT_GATES)
  })

  it.each(DOCUMENTS)(
    '$file documents exactly the gates scripts/verify.sh runs, in order',
    ({ file, extract }) => {
      const lists = extract(read(file))
      expect(lists.length, `${file} documents no gate list`).toBeGreaterThan(0)
      for (const list of lists) {
        expect(
          list.map((item) => normaliseGate(item, file)),
          `${file} gate list`
        ).toEqual(SCRIPT_GATES)
      }
    }
  )
})

describe('release versions are not claimed outside the maintained places', () => {
  const pkg = JSON.parse(read('package.json')) as { version: string }

  /** Release-version-looking text: `0.28.0`, `v0.28.0`, `0.28.x`. */
  const RELEASE_VERSION = /(?<![\w./-])v?(\d+\.\d+\.(?:x|\d+))(?![\w./-])/g

  function versionStringsIn(text: string): string[] {
    // Link targets and URLs may legitimately contain version-like path
    // segments (e.g. a changelog-spec URL); only prose counts as a claim.
    const prose = text.replace(/\]\([^)]*\)/g, ']').replace(/https?:\/\/\S+/g, '')
    return [...prose.matchAll(RELEASE_VERSION)].map((m) => m[1])
  }

  function compareVersions(a: string, b: string): number {
    const pa = a.split('.').map(Number)
    const pb = b.split('.').map(Number)
    for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i]
    return 0
  }

  // Live policy documents point at the Releases page instead of naming a
  // version: scripts/release.sh rewrites only package.json and README's
  // "Current version" marker, so a version in these files would go stale
  // silently on the next release. The most recent release is described by
  // reference ("the current release line"), never by number.
  const LIVE_DOCS = [
    'SECURITY.md',
    'CONTRIBUTING.md',
    'CODE_OF_CONDUCT.md',
    'GOVERNANCE.md',
    'ROADMAP.md',
    'FUNDING.md',
    'HERMES.md'
  ] as const

  it.each(LIVE_DOCS)('%s names no release version', (rel) => {
    expect(
      versionStringsIn(read(rel)),
      `${rel} hardcodes a release version as a live claim — point at the Releases page instead`
    ).toEqual([])
  })

  it('README advertises the package version the release script bumps', () => {
    const match = read('README.md').match(/Current version:\s*\*\*(\d+\.\d+\.\d+)\*\*/)
    expect(match, 'README has no "Current version: **x.y.z**" marker').toBeTruthy()
    expect(match![1]).toBe(pkg.version)
  })

  // The dated evidence records (PROJECT-HEALTH, VERIFICATION) legitimately name
  // the release they snapshot — that is history, not a live claim — but only
  // when they pin the commit the snapshot was taken at. A version there must
  // agree with what that commit actually carried, so editing one without the
  // other fails; and a snapshot can never name a version newer than the
  // package. On a shallow CI checkout the pinned commit is absent, in which
  // case only the "not newer" bound and the anchor requirement apply.
  const SNAPSHOT_DOCS = ['docs/PROJECT-HEALTH.md', 'docs/VERIFICATION.md'] as const

  it.each(SNAPSHOT_DOCS)('%s anchors its snapshot version to a commit', (rel) => {
    const text = read(rel)
    const header = text.split('\n').slice(0, 12).join('\n')
    const commit = header.match(/\*\*Commit:\*\*\s*`([0-9a-f]{40})`/)
    expect(commit, `${rel} must pin the snapshot to a full 40-char commit`).toBeTruthy()
    const release = header.match(/\*\*Release:\*\*\s*v?(\d+\.\d+\.\d+)/)
    expect(release, `${rel} must name the release its snapshot recorded`).toBeTruthy()

    const recorded = release![1]
    const sha = commit![1]
    const commitPresent =
      spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: ROOT }).status === 0
    if (commitPresent) {
      const atCommit = JSON.parse(
        execSync(`git show ${sha}:package.json`, { cwd: ROOT, encoding: 'utf8' })
      ) as { version: string }
      expect(
        recorded,
        `${rel} names v${recorded} but ${sha.slice(0, 7)} carried v${atCommit.version}`
      ).toBe(atCommit.version)
    }
    expect(
      compareVersions(recorded, pkg.version),
      `${rel} names v${recorded}, newer than package.json's v${pkg.version}`
    ).toBeLessThanOrEqual(0)
  })
})

describe('link integrity', () => {
  const LINK_FILES = [
    'README.md',
    'SECURITY.md',
    'CONTRIBUTING.md',
    'CODE_OF_CONDUCT.md',
    'GOVERNANCE.md',
    'ROADMAP.md',
    'FUNDING.md',
    'CHANGELOG.md',
    'THIRD-PARTY-NOTICES.md',
    'docs/PROJECT-HEALTH.md',
    'docs/VERIFICATION.md'
  ] as const

  // Hosts we intentionally link to from public docs.
  const ALLOWED_HOSTS = new Set([
    'github.com',
    'img.shields.io',
    'termsprawl.com',
    'docs.termsprawl.com',
    'contributor-covenant.org',
    'www.contributor-covenant.org',
    'keepachangelog.com',
    'semver.org',
    'simpleicons.org',
    'creativecommons.org',
    'opensource.org'
  ])

  function linksIn(rel: string): Array<{ target: string; line: number }> {
    const body = read(rel).replace(/```[\s\S]*?```/g, '')
    const out: Array<{ target: string; line: number }> = []
    const pattern = /\[[^\]]*\]\(([^)\s]+)\)/g
    let match: RegExpExecArray | null
    while ((match = pattern.exec(body)) !== null) {
      out.push({ target: match[1], line: body.slice(0, match.index).split('\n').length })
    }
    return out
  }

  it.each(LINK_FILES)('%s links resolve to a real local path or an allowed public host', (rel) => {
    for (const { target, line } of linksIn(rel)) {
      if (target.startsWith('#') || target.startsWith('mailto:')) continue
      if (target.startsWith('http://') || target.startsWith('https://')) {
        const url = new URL(target)
        if (url.host === 'github.com') {
          const blob = url.pathname.match(/^\/dazeb\/termsprawl\/blob\/[^/]+\/(.+)$/)
          if (blob) {
            expect(existsSync(resolve(ROOT, decodeURIComponent(blob[1]))), `${rel}:${line} → ${target}`).toBe(
              true
            )
            continue
          }
        }
        expect(ALLOWED_HOSTS.has(url.host), `${rel}:${line} links to an unverified host: ${target}`).toBe(
          true
        )
        continue
      }
      const local = resolve(ROOT, dirname(rel), decodeURIComponent(target.split('#')[0]))
      expect(existsSync(local), `${rel}:${line} → missing local path ${target}`).toBe(true)
    }
  })
})

describe('private infrastructure is not published', () => {
  const OPERATIONAL_FILES = ['AGENTS.md', 'PLAN.md', 'HERMES.md', 'docs/SPACES-OPS.md'] as const

  it.each(OPERATIONAL_FILES)('%s contains no private IP, container id, or key path', (rel) => {
    const text = read(rel)
    expect(text, 'private IPv4 range').not.toMatch(/\b(?:192\.168|10\.(?:\d{1,3}\.)|172\.(?:1[6-9]|2\d|3[01])\.)\d{1,3}\.\d{1,3}\b/)
    expect(text, 'public server IP').not.toContain('178.104.6.193')
    expect(text, 'container id').not.toMatch(/\bCT\s?(?:100|109)\b/)
    expect(text, 'private key path').not.toContain('~/.ssh/hermes-box_ed25519')
  })

  it('PLAN.md no longer carries a personal messaging identifier', () => {
    const plan = read('PLAN.md')
    expect(plan).not.toContain('1033877751')
    const telegramLines = plan.split('\n').filter((line) => /telegram/i.test(line))
    for (const line of telegramLines) {
      expect(line, `personal identifier in: ${line}`).not.toMatch(/(?<!\d)\d{9,}(?!\d)/)
    }
  })

  // Screenshots leak the same class of data as prose — absolute home paths,
  // account emails, host names — but no text assertion can see inside a PNG.
  // This does not inspect pixels; it forces new imagery to be a deliberate,
  // reviewed addition instead of an unnoticed one.
  it('published screenshots are explicitly listed as reviewed', () => {
    const REVIEWED_SCREENSHOTS = ['docs/media/termsprawl-canvas.png'] as const
    const tracked = execSync('git ls-files docs/media', { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)

    for (const asset of tracked) {
      expect(
        REVIEWED_SCREENSHOTS as readonly string[],
        `${asset} is published but not listed as reviewed — check it for personal paths, emails, and host names, then add it here`
      ).toContain(asset)
    }
    expect(tracked.sort()).toEqual([...REVIEWED_SCREENSHOTS].sort())
  })
})

describe('package metadata', () => {
  it('declares repository, bugs, engines, and the pnpm package manager', () => {
    const pkg = JSON.parse(read('package.json')) as Record<string, unknown>
    expect(pkg.license).toBe('MIT')
    expect(pkg.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/dazeb/termsprawl.git'
    })
    expect(pkg.bugs).toEqual({ url: 'https://github.com/dazeb/termsprawl/issues' })
    expect(pkg.engines).toMatchObject({ node: '>=20' })
    expect(pkg.packageManager).toBe('pnpm@11.21.0')
    expect(pkg.author).toMatchObject({ name: 'Darren Bennett', email: 'daz@dazeb.dev' })
  })
})

describe('policy document essentials', () => {
  it('SECURITY.md reports privately and never asks for secrets', () => {
    const security = read('SECURITY.md')
    expect(security).toContain('https://github.com/dazeb/termsprawl/security/advisories/new')
    expect(security).toMatch(/never (share|include|send)|do not (share|include|send)/i)
    expect(security).toMatch(/secrets|tokens|credentials/i)
  })

  it('CONTRIBUTING.md carries prerequisites, the gate command, and licensing terms', () => {
    const contributing = read('CONTRIBUTING.md')
    expect(contributing).toContain('Node 20')
    expect(contributing).toContain('pnpm 11')
    expect(contributing).toMatch(/tmux/)
    expect(contributing).toContain('pnpm run verify')
    expect(contributing).toMatch(/MIT/)
    expect(contributing).toMatch(/no CLA or DCO/i)
    expect(contributing).toMatch(/GitHub Actions/i)
  })

  it('CODE_OF_CONDUCT.md is Contributor Covenant 2.1 with the maintainer as contact', () => {
    const conduct = read('CODE_OF_CONDUCT.md')
    expect(conduct).toContain('Contributor Covenant')
    expect(conduct).toContain('2.1')
    expect(conduct).toContain('daz@dazeb.dev')
    // Contributor Covenant 2.1 ships under CC BY 4.0 — asserting BY-SA here
    // would encode a license the upstream project never used.
    expect(conduct).toMatch(/CC BY 4\.0/)
    expect(conduct).not.toMatch(/CC BY-SA/)
  })

  it('GOVERNANCE.md names the sole maintainer and a successor path', () => {
    const governance = read('GOVERNANCE.md')
    expect(governance).toContain('Darren Bennett')
    expect(governance).toMatch(/sole maintainer/i)
    expect(governance).toMatch(/successor|succession|archiv/i)
    expect(governance).not.toMatch(/fiscal sponsor|board of directors/i)
  })

  it('ROADMAP.md lists the funding-dependent work packages and non-goals', () => {
    const roadmap = read('ROADMAP.md')
    for (const topic of [
      /reliability/i,
      /Server Edition/i,
      /agent interoperability/i,
      /accessibility/i,
      /1\.0/i
    ]) {
      expect(roadmap).toMatch(topic)
    }
    expect(roadmap).toMatch(/no macOS|not add macOS|macOS is out of scope/i)
  })

  it('CHANGELOG.md is Keep a Changelog shaped and backfills the recent releases without invented dates', () => {
    const changelog = read('CHANGELOG.md')
    expect(changelog).toContain('Keep a Changelog')
    expect(changelog).toContain('Semantic Versioning')
    for (const version of ['0.26.0', '0.27.0', '0.28.0']) {
      expect(changelog).toContain(version)
    }
    for (const date of ['2026-09-16', '2026-09-17', '2026-09-18']) {
      expect(changelog).toContain(date)
    }
  })

  it('issue templates disable blank issues and route security reports privately', () => {
    const config = read('.github/ISSUE_TEMPLATE/config.yml')
    expect(config).toContain('blank_issues_enabled: false')
    expect(config).toContain('https://github.com/dazeb/termsprawl/security/advisories/new')
    expect(read('.github/CODEOWNERS')).toContain('@dazeb')
  })
})
