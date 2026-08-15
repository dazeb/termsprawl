import { describe, expect, it } from 'vitest'
import { normalizeClaudeHook } from './agent-status'

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
      ts: expect.any(Number)
    })
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
