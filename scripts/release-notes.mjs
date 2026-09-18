#!/usr/bin/env node
// Release notes for a version, sourced from CHANGELOG.md.
//
// Usage: node scripts/release-notes.mjs <version> [changelog-path]
//   <version>  e.g. 0.29.0 (no leading "v")
//
// Prints the release notes body on stdout (wrapped in a title and an install
// section) for the release pipeline to write to RELEASE_NOTES.md. The notes
// are the CHANGELOG.md section for that exact version, so the published text
// matches what the repository records.
//
// If no entry exists for the version, an explicit fallback is printed (and a
// warning goes to stderr) so the release still gets nonempty notes instead of
// silently shipping an empty page. A section that exists but has no body is
// treated as malformed and exits nonzero — a released version should either
// record its changes or be missing a section on purpose.
import { readFileSync } from 'node:fs'

const [version, changelogArg] = process.argv.slice(2)

if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('usage: node scripts/release-notes.mjs <version> [changelog-path]')
  console.error('  e.g. node scripts/release-notes.mjs 0.29.0')
  process.exit(2)
}

const changelogPath = changelogArg ?? 'CHANGELOG.md'
let changelog = ''
try {
  changelog = readFileSync(changelogPath, 'utf8')
} catch {
  // Missing file is a missing entry: fall through to the explicit fallback.
}

const lines = changelog.split('\n')
const headerPattern = new RegExp(`^##\\s+\\[?${version.replace(/\./g, '\\.')}\\]?(\\s|$)`)
const start = lines.findIndex((line) => headerPattern.test(line))

let body = ''
let fallback = false
if (start === -1) {
  fallback = true
} else {
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => /^##\s/.test(line))
  const section = end === -1 ? rest : rest.slice(0, end)
  // Trailing link-reference definitions ([1.2.3]: https://…) belong to the
  // changelog's footer, not to the release notes body.
  while (section.length > 0 && (section[section.length - 1].trim() === '' || /^\[[^\]]+\]:/.test(section[section.length - 1]))) {
    section.pop()
  }
  body = section.join('\n').trim()
  if (body === '') {
    console.error(`release-notes: CHANGELOG.md has an empty section for ${version} — add the entries or remove the heading`)
    process.exit(1)
  }
}

if (fallback) {
  console.error(`release-notes: no CHANGELOG.md entry found for ${version}; emitting the explicit fallback`)
}

const notes = fallback
  ? [
      `# termsprawl ${version}`,
      '',
      `> No CHANGELOG.md entry was found for ${version} at release time. The`,
      '> published artifacts correspond to the release tag; see the commit',
      '> history for the change list, and backfill CHANGELOG.md so future',
      '> notes are complete.',
      '',
      '## Install',
      '',
      `Download the AppImage or \`.deb\` from the [Releases](https://github.com/dazeb/termsprawl/releases/tag/v${version}) page.`,
      'Each release also publishes `SHA256SUMS`; verify a download with',
      '`sha256sum -c SHA256SUMS`.',
      ''
    ].join('\n')
  : [
      `# termsprawl ${version}`,
      '',
      body,
      '',
      '## Install',
      '',
      `Download the AppImage or \`.deb\` from the [Releases](https://github.com/dazeb/termsprawl/releases/tag/v${version}) page.`,
      'Each release also publishes `SHA256SUMS`; verify a download with',
      '`sha256sum -c SHA256SUMS`.',
      ''
    ].join('\n')

process.stdout.write(notes)
