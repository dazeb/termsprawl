// Phase 8.4 — AI commit message helpers. Pure, electron-free. TDD: the failing
// tests below drive the implementation in commit-message.ts.
import { describe, it, expect } from 'vitest'
import { buildCommitPrompt, parseCommitMessage, detectAgentCli } from './commit-message'

describe('buildCommitPrompt', () => {
  it('includes the staged diff in the prompt', () => {
    const p = buildCommitPrompt('diff --git a/x b/x\n+line\n')
    expect(p).toContain('diff --git a/x b/x')
    expect(p).toContain('+line')
  })

  it('asks for a conventional commit message format', () => {
    const p = buildCommitPrompt('x')
    expect(p).toMatch(/type\(scope\): subject/i)
    expect(p.toLowerCase()).toContain('conventional')
  })

  it('bounded: truncates a very large diff', () => {
    const big = 'x'.repeat(20000)
    const p = buildCommitPrompt(big)
    expect(p.length).toBeLessThan(12000)
  })
})

describe('parseCommitMessage', () => {
  it('extracts the subject from a code-fenced response', () => {
    const out = 'Here is your message:\n```\nfeat(canvas): add undo/redo\n```\n'
    expect(parseCommitMessage(out)).toBe('feat(canvas): add undo/redo')
  })

  it('strips quotes and returns a single clean line', () => {
    expect(parseCommitMessage('"fix: resolve ozone crash"')).toBe('fix: resolve ozone crash')
  })

  it('returns empty when nothing usable is present', () => {
    expect(parseCommitMessage('\n\n')).toBe('')
    expect(parseCommitMessage('```\n```')).toBe('')
  })
})

describe('detectAgentCli', () => {
  it('prefers claude when present', () => {
    expect(detectAgentCli((b) => b === 'claude')).toBe('claude')
  })
  it('falls back to codex when claude is missing', () => {
    expect(detectAgentCli((b) => b === 'codex')).toBe('codex')
  })
  it('returns none when no agent CLI is found', () => {
    expect(detectAgentCli((b) => false)).toBe('none')
  })
})
