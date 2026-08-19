// Context-link discovery markers (Phase 7, Task 7.5).
//
// So a Claude session whose cwd is the project can actually FIND the context
// CLI, we plant two project-local markers (never `~/.claude`, never the user's
// root AGENTS.md):
//
//   1. <cwd>/.termsprawl/AGENTS.md      — managed block between markers
//   2. <cwd>/.claude/skills/termsprawl-context/SKILL.md
//
// `TERMSPRAWL_NODE_ID` is injected at spawn (see main/withAgentNodeIdEnv), so
// the block/skill tell the agent to run the CLI with its own id. Electron-free,
// fail-open, and writes ONLY under the given cwd.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const CONTEXT_LINKS_OPEN = '<!-- termsprawl:context-links -->'
export const CONTEXT_LINKS_CLOSE = '<!-- /termsprawl:context-links -->'

const AGENTS_BLOCK = [
  CONTEXT_LINKS_OPEN,
  'Linked agent context: run',
  '`.termsprawl/bin/termsprawl-context --cwd . --self "$TERMSPRAWL_NODE_ID"`',
  'to print peer transcripts. Only read what that command prints.',
  CONTEXT_LINKS_CLOSE
].join('\n')

const SKILL_BODY =
  [
    '---',
    'name: termsprawl-context',
    // YAML: a plain scalar with an apostrophe is fine unquoted.
    "description: When you need another termsprawl agent's conversation.",
    '---',
    '# termsprawl context',
    '',
    'Run `.termsprawl/bin/termsprawl-context --cwd . --self "$TERMSPRAWL_NODE_ID"`',
    'to print the recent turns of agents linked to this node. Only read what',
    'that command prints.'
  ].join('\n') + '\n'

/** Insert or replace the managed context-links block in a file's text,
 * preserving any user prose above and below the markers. Idempotent: a second
 * pass with no surrounding change returns the same string. */
export function upsertManagedAgentsBlock(content: string): string {
  const open = content.indexOf(CONTEXT_LINKS_OPEN)
  const close = content.indexOf(CONTEXT_LINKS_CLOSE)
  const hasBlock = open !== -1 && close !== -1 && close > open
  const before = (hasBlock ? content.slice(0, open) : content).trimEnd()
  const after = hasBlock ? content.slice(close + CONTEXT_LINKS_CLOSE.length).trim() : ''
  const parts: string[] = []
  if (before) parts.push(before)
  parts.push(AGENTS_BLOCK)
  if (after) parts.push(after)
  return parts.join('\n\n') + '\n'
}

/** Ensure both discovery markers exist under `cwd`. Best-effort; never throws. */
export function ensureContextDiscovery(cwd: string): void {
  if (!cwd) return

  try {
    const agentsPath = join(cwd, '.termsprawl', 'AGENTS.md')
    const existing = readText(agentsPath)
    const next = upsertManagedAgentsBlock(existing)
    if (next !== existing) {
      mkdirSync(dirname(agentsPath), { recursive: true })
      writeFileSync(agentsPath, next, 'utf8')
    }
  } catch {
    // fail-open: discovery is best-effort
  }

  try {
    const skillPath = join(cwd, '.claude', 'skills', 'termsprawl-context', 'SKILL.md')
    if (readText(skillPath) !== SKILL_BODY) {
      mkdirSync(dirname(skillPath), { recursive: true })
      writeFileSync(skillPath, SKILL_BODY, 'utf8')
    }
  } catch {
    // fail-open
  }
}

function readText(path: string): string {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : ''
  } catch {
    return ''
  }
}
