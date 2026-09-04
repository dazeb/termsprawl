import { describe, expect, it } from 'vitest'
import { normalizeClaudeHook, normalizeCodexHook } from './agent-status'
import { shouldNotify } from '../shared/agent-status'

// Claude Code posts URL-hook payloads containing hook_event_name + session_id.
// We normalize those into the shared status model (working/waiting/blocked/done)
// so the renderer can show RUNNING / NEEDS YOU badges.

describe('normalizeClaudeHook', () => {
  it('maps PreToolUse to working with the tool name', () => {
    const event = normalizeClaudeHook({
      hook_event_name: 'PreToolUse',
      session_id: 'sess-1',
      tool_name: 'Bash',
      cwd: '/repo',
      transcript_path: '/tmp/t.json'
    })
    expect(event).toEqual({
      sessionId: 'sess-1',
      status: 'working',
      kind: 'session',
      tool: 'Bash',
      transcriptPath: '/tmp/t.json',
      ts: expect.any(Number)
    })
  })

  it('passes transcript_path through so main can read the session name', () => {
    const event = normalizeClaudeHook({
      hook_event_name: 'Stop',
      session_id: 'sess-1',
      transcript_path: '/home/u/.claude/projects/p/sess-1.jsonl'
    })
    expect(event?.transcriptPath).toBe('/home/u/.claude/projects/p/sess-1.jsonl')
  })

  it('omits transcriptPath when the payload has no transcript_path', () => {
    const event = normalizeClaudeHook({
      hook_event_name: 'Notification',
      session_id: 'sess-1'
    })
    expect(event?.transcriptPath).toBeUndefined()
  })

  it('maps PostToolUse to working', () => {
    const event = normalizeClaudeHook({
      hook_event_name: 'PostToolUse',
      session_id: 'sess-1',
      tool_name: 'Edit'
    })
    expect(event?.status).toBe('working')
  })

  it('maps UserPromptSubmit to working', () => {
    const event = normalizeClaudeHook({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'sess-1'
    })
    expect(event?.status).toBe('working')
  })

  it('maps Notification to waiting (needs user)', () => {
    const event = normalizeClaudeHook({
      hook_event_name: 'Notification',
      session_id: 'sess-1'
    })
    expect(event?.status).toBe('waiting')
  })

  it('maps PermissionRequest to blocked', () => {
    const event = normalizeClaudeHook({
      hook_event_name: 'PermissionRequest',
      session_id: 'sess-1'
    })
    expect(event?.status).toBe('blocked')
  })

  it('maps Stop to done', () => {
    const event = normalizeClaudeHook({
      hook_event_name: 'Stop',
      session_id: 'sess-1'
    })
    expect(event?.status).toBe('done')
  })

  it('maps SubagentStop to done with kind subagent', () => {
    const event = normalizeClaudeHook({
      hook_event_name: 'SubagentStop',
      session_id: 'sess-1',
      subagent_id: 'sub-9'
    })
    expect(event?.status).toBe('done')
    expect(event?.kind).toBe('subagent')
  })

  it('returns null for unknown payloads and missing session ids', () => {
    expect(normalizeClaudeHook({ hook_event_name: 'SomethingNew' })).toBeNull()
    expect(normalizeClaudeHook({})).toBeNull()
    expect(normalizeClaudeHook(null)).toBeNull()
  })
})

describe('normalizeCodexHook', () => {
  // Codex CLI (0.149+) fires command-type hooks with the SAME payload
  // vocabulary as Claude (hook_event_name, session_id, transcript_path,
  // tool_name) — verified against the codex 0.149.1 binary's hook engine.
  // Event set differs slightly: SessionStart/SessionEnd/SubagentStart exist;
  // Notification does not (codex has RequestUserInput/PermissionRequest).

  it('maps PreToolUse to working with the tool name', () => {
    const event = normalizeCodexHook({
      hook_event_name: 'PreToolUse',
      session_id: 'cx-1',
      tool_name: 'shell',
      cwd: '/repo',
      transcript_path: '/tmp/cx.json'
    })
    expect(event).toEqual({
      sessionId: 'cx-1',
      status: 'working',
      kind: 'session',
      tool: 'shell',
      transcriptPath: '/tmp/cx.json',
      ts: expect.any(Number)
    })
  })

  it('maps PostToolUse and UserPromptSubmit to working', () => {
    expect(normalizeCodexHook({ hook_event_name: 'PostToolUse', session_id: 'cx-1' })?.status).toBe('working')
    expect(normalizeCodexHook({ hook_event_name: 'UserPromptSubmit', session_id: 'cx-1' })?.status).toBe('working')
  })

  it('maps PermissionRequest to blocked', () => {
    const event = normalizeCodexHook({ hook_event_name: 'PermissionRequest', session_id: 'cx-1' })
    expect(event?.status).toBe('blocked')
  })

  it('maps Stop to done', () => {
    expect(normalizeCodexHook({ hook_event_name: 'Stop', session_id: 'cx-1' })?.status).toBe('done')
  })

  it('maps SubagentStop to done with kind subagent', () => {
    const event = normalizeCodexHook({ hook_event_name: 'SubagentStop', session_id: 'cx-1', subagent_id: 'sub-1' })
    expect(event?.status).toBe('done')
    expect(event?.kind).toBe('subagent')
  })

  it('session lifecycle events are recognized but carry no status (no badge churn)', () => {
    for (const name of ['SessionStart', 'SessionEnd', 'SubagentStart', 'PreCompact', 'PostCompact']) {
      const event = normalizeCodexHook({ hook_event_name: name, session_id: 'cx-1' })
      expect(event, name).not.toBeNull()
      expect(event?.status, name).toBeUndefined()
    }
  })

  it('returns null for unknown payloads and missing session ids', () => {
    expect(normalizeCodexHook({ hook_event_name: 'SomethingNew', session_id: 'cx' })).toBeNull()
    expect(normalizeCodexHook({ hook_event_name: 'Stop' })).toBeNull()
    expect(normalizeCodexHook(null)).toBeNull()
  })
})

describe('shouldNotify', () => {
  const base = { knownSession: true, windowFocused: false }

  it('notifies on a transition into done/waiting/blocked while unfocused', () => {
    expect(shouldNotify('working', 'done', base)).toBe(true)
    expect(shouldNotify('working', 'waiting', base)).toBe(true)
    expect(shouldNotify('working', 'blocked', base)).toBe(true)
  })

  it('notifies on a first event that is already terminal', () => {
    expect(shouldNotify(undefined, 'done', base)).toBe(true)
    expect(shouldNotify(undefined, 'waiting', base)).toBe(true)
  })

  it('does not notify when the window is focused', () => {
    expect(shouldNotify('working', 'done', { ...base, windowFocused: true })).toBe(false)
  })

  it('does not notify for unknown (non-node) sessions', () => {
    expect(shouldNotify('working', 'done', { ...base, knownSession: false })).toBe(false)
  })

  it('does not notify on non-terminal or repeated status', () => {
    expect(shouldNotify('working', 'working', base)).toBe(false)
    expect(shouldNotify('done', 'done', base)).toBe(false)
    expect(shouldNotify(undefined, 'working', base)).toBe(false)
  })
})
