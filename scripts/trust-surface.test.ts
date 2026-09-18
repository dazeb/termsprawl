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

  it('CONTRIBUTING.md carries prerequisites, the gate order, and licensing terms', () => {
    const contributing = read('CONTRIBUTING.md')
    expect(contributing).toContain('Node 20')
    expect(contributing).toContain('pnpm 11')
    expect(contributing).toMatch(/tmux/)
    const gates = [
      'pnpm run typecheck',
      'pnpm run build',
      'pnpm run build:server',
      'python3 scripts/release-safety.test.py',
      'pnpm test'
    ]
    let cursor = -1
    for (const gate of gates) {
      const at = contributing.indexOf(gate)
      expect(at, `missing gate: ${gate}`).toBeGreaterThan(-1)
      expect(at, `gate out of order: ${gate}`).toBeGreaterThan(cursor)
      cursor = at
    }
    expect(contributing).toMatch(/MIT/)
    expect(contributing).toMatch(/no CLA or DCO/i)
    expect(contributing).toMatch(/GitHub Actions/i)
  })

  it('CODE_OF_CONDUCT.md is Contributor Covenant 2.1 with the maintainer as contact', () => {
    const conduct = read('CODE_OF_CONDUCT.md')
    expect(conduct).toContain('Contributor Covenant')
    expect(conduct).toContain('2.1')
    expect(conduct).toContain('daz@dazeb.dev')
    expect(conduct).toMatch(/CC BY-SA/)
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
