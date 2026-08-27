// Phase 8.4 — AI commit message generation. Spawns a BYO local agent CLI
// (claude or codex, whichever is present) read-only against the staged diff and
// captures a conventional commit message. Electron-free; the Server Edition
// boots the same core.
//
// Clean-room: argv-array spawns only, never a shell string. The prompt and diff
// are passed as a single argv argument (bounded in size), so nothing is ever
// interpolated into a shell.

import { spawn, spawnSync } from 'node:child_process'
import { stagedDiff } from './git-service'
import type { CommitAgentCli, CommitMessageResult } from '../shared/types'

const MAX_DIFF_CHARS = 6000
const AGENT_TIMEOUT_MS = 120_000

/** Build the instruction prompt (with the bounded diff) sent to the agent CLI. */
export function buildCommitPrompt(diff: string): string {
  const bounded =
    diff.length > MAX_DIFF_CHARS ? `${diff.slice(0, MAX_DIFF_CHARS)}\n…(truncated)` : diff
  return [
    'Write a conventional commit message for the staged diff below.',
    'Format: type(scope): subject, where type is one of feat/fix/chore/docs/',
    'refactor/test/style/perf/build/ci. Return ONLY the message — one-line subject,',
    'then an optional short body on the following lines. No explanations, no fences.',
    '',
    '<diff>',
    bounded,
    '</diff>'
  ].join('\n')
}

/** Extract a clean single subject line from the agent's (possibly chatty) output. */
export function parseCommitMessage(output: string): string {
  const cleaned: string[] = []
  for (const raw of output.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('```')) continue // markdown fences
    if (/^(here is|here's|commit message|suggested|the commit|based on)/i.test(line)) continue
    cleaned.push(stripWrap(line))
  }
  return cleaned[0] ?? ''
}

function stripWrap(line: string): string {
  return line.replace(/^["'\u201c\u2018]+|["'\u201d\u2019]+$/g, '').trim()
}

/** Prefer claude, then codex; 'none' when neither is on PATH. `probe` is injected for tests. */
export function detectAgentCli(probe: (bin: string) => boolean): CommitAgentCli | 'none' {
  if (probe('claude')) return 'claude'
  if (probe('codex')) return 'codex'
  return 'none'
}

/** is-exe probe without a shell: `which <bin>` (argv-array, status only). */
function binOnPath(bin: string): boolean {
  try {
    return spawnSync('which', [bin], { stdio: 'ignore' }).status === 0
  } catch {
    return false
  }
}

interface AgentOutput {
  output?: string
  error?: string
}

/** Run the agent CLI read-only with the prompt on argv; capture its output. */
function runAgentCli(tool: CommitAgentCli, prompt: string, cwd: string): Promise<AgentOutput> {
  return new Promise((resolve) => {
    const args = tool === 'claude' ? ['-p', prompt] : ['exec', prompt]
    let settled = false
    const done = (out: AgentOutput): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(out)
    }

    const child = spawn(tool, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    let output = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => {
      output += d.toString()
    })
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    child.on('error', (err) => done({ error: `${tool} failed to spawn: ${err.message}` }))
    child.on('close', (code) => {
      if (code === 0) done({ output })
      else done({ error: `${tool} exited ${code}: ${stderr.trim().slice(0, 500)}` })
    })
    // No stdin needed; close it so the CLI never waits on input.
    child.stdin.end()

    const timer = setTimeout(() => done({ error: `${tool} timed out` }), AGENT_TIMEOUT_MS)
  })
}

/** Orchestrate: staged diff → detect CLI → spawn read-only → parse a subject.
 * Local path: the diff is read from the local repo. */
export async function generateCommitMessage(repoRoot: string): Promise<CommitMessageResult> {
  const diff = await stagedDiff(repoRoot)
  return generateCommitMessageFromDiff(diff, repoRoot)
}

/** Same as above but the caller supplies the staged diff (remote projects fetch
 * it over ssh first — see main's git:commit-message handler). */
export async function generateCommitMessageFromDiff(
  diff: string,
  cwd = process.cwd()
): Promise<CommitMessageResult> {
  if (!diff.trim()) return { ok: false, error: 'nothing staged to commit' }

  const tool = detectAgentCli(binOnPath)
  if (tool === 'none') {
    return { ok: false, error: 'no agent CLI found; install claude or codex' }
  }

  const out = await runAgentCli(tool, buildCommitPrompt(diff), cwd)
  if (out.error) return { ok: false, error: out.error, tool }
  const message = parseCommitMessage(out.output ?? '')
  if (!message) return { ok: false, error: 'agent returned no commit message', tool }
  return { ok: true, message, tool }
}
