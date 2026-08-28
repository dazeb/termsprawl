import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'

import {
  startDeviceFlow,
  pollForToken,
  fetchLogin,
  hashToken,
  upsertUser
} from './github-auth.mjs'

// Scripted fake fetch: each call pops the next handler from a list. Each
// handler gets { url, opts } and returns { status, json }.
function fakeFetch(handlers) {
  const calls = []
  const fetchFn = async (url, opts = {}) => {
    calls.push({ url, opts })
    const h = handlers.shift()
    if (!h) throw new Error('unexpected fetch call: ' + url)
    const r = await h({ url, opts })
    return {
      ok: (r.status ?? 200) >= 200 && (r.status ?? 200) < 300,
      status: r.status ?? 200,
      json: async () => r.json
    }
  }
  return { fetchFn, calls }
}

describe('startDeviceFlow', () => {
  it('POSTs to the device-code endpoint and maps the response', async () => {
    const { fetchFn, calls } = fakeFetch([
      () => ({
        json: {
          device_code: 'DEV-123',
          user_code: 'ABCD-1234',
          verification_uri: 'https://github.com/login/device',
          interval: 5,
          expires_in: 900
        }
      })
    ])
    const out = await startDeviceFlow({ clientId: 'cid', fetchFn })
    expect(out).toEqual({
      deviceCode: 'DEV-123',
      userCode: 'ABCD-1234',
      verificationUri: 'https://github.com/login/device',
      interval: 5,
      expiresInSeconds: 900
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://github.com/login/device/code')
    expect(calls[0].opts.method).toBe('POST')
    expect(calls[0].opts.headers.Accept).toBe('application/json')
    expect(calls[0].opts.body).toContain('client_id=cid')
  })
})

describe('pollForToken', () => {
  it('keeps polling on authorization_pending, honoring the interval, then succeeds', async () => {
    const { fetchFn, calls } = fakeFetch([
      () => ({ json: { error: 'authorization_pending' } }),
      () => ({ json: { error: 'authorization_pending' } }),
      () => ({ json: { access_token: 'tok-1' } })
    ])
    const sleeps = []
    const token = await pollForToken({
      clientId: 'cid',
      deviceCode: 'DEV-123',
      interval: 7,
      fetchFn,
      sleepFn: async (ms) => sleeps.push(ms),
      maxAttempts: 10
    })
    expect(token).toEqual({ accessToken: 'tok-1' })
    expect(sleeps).toEqual([7000, 7000])
    expect(calls).toHaveLength(3)
    for (const c of calls) {
      expect(c.url).toBe('https://github.com/login/oauth/access_token')
      expect(c.opts.method).toBe('POST')
      expect(c.opts.headers.Accept).toBe('application/json')
      expect(c.opts.body).toContain('device_code=DEV-123')
      expect(c.opts.body).toContain('grant_type=urn:ietf:params:oauth:grant-type:device_code')
    }
  })

  it('slow_down adds 5s to the next sleep', async () => {
    const { fetchFn } = fakeFetch([
      () => ({ json: { error: 'slow_down' } }),
      () => ({ json: { error: 'authorization_pending' } }),
      () => ({ json: { access_token: 'tok-2' } })
    ])
    const sleeps = []
    const token = await pollForToken({
      clientId: 'cid',
      deviceCode: 'DEV',
      interval: 5,
      fetchFn,
      sleepFn: async (ms) => sleeps.push(ms),
      maxAttempts: 10
    })
    expect(token).toEqual({ accessToken: 'tok-2' })
    expect(sleeps).toEqual([5000, 10000]) // 5s, then 5s + 5s slow_down penalty
  })

  it('throws on a hard OAuth error and on exceeding maxAttempts', async () => {
    const hard = fakeFetch([() => ({ json: { error: 'access_denied' } })])
    await expect(
      pollForToken({ clientId: 'cid', deviceCode: 'D', interval: 1, fetchFn: hard.fetchFn, sleepFn: async () => {}, maxAttempts: 3 })
    ).rejects.toMatchObject({ code: 'access_denied' })

    const never = fakeFetch(Array(30).fill(() => ({ json: { error: 'authorization_pending' } })))
    await expect(
      pollForToken({ clientId: 'cid', deviceCode: 'D', interval: 1, fetchFn: never.fetchFn, sleepFn: async () => {}, maxAttempts: 3 })
    ).rejects.toMatchObject({ code: 'TIMEOUT' })
  })
})

describe('fetchLogin', () => {
  it('GETs /user with a Bearer token and returns the login', async () => {
    const { fetchFn, calls } = fakeFetch([
      () => ({ json: { login: 'octocat', id: 1 } })
    ])
    const login = await fetchLogin({ accessToken: 'tok-9', fetchFn })
    expect(login).toBe('octocat')
    expect(calls[0].url).toBe('https://api.github.com/user')
    expect(calls[0].opts.method).toBe('GET')
    expect(calls[0].opts.headers.Authorization).toBe('Bearer tok-9')
    expect(calls[0].opts.headers.Accept).toBe('application/vnd.github+json')
  })

  it('throws when GitHub rejects the token', async () => {
    const { fetchFn } = fakeFetch([() => ({ status: 401, json: { message: 'Bad credentials' } })])
    await expect(fetchLogin({ accessToken: 'nope', fetchFn })).rejects.toMatchObject({ code: 'GITHUB' })
  })
})

describe('token storage', () => {
  it('hashToken is sha256 hex', () => {
    const h = hashToken('raw-token')
    expect(h).toBe(crypto.createHash('sha256').update('raw-token', 'utf8').digest('hex'))
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })

  it('upsertUser stores the hash, never the raw token; second call updates in place', () => {
    const store = { users: [], invites: [] }
    upsertUser(store, 'octo', 'raw-a', { now: 111 })
    expect(store.users).toEqual([
      { login: 'octo', tokenHash: hashToken('raw-a'), createdAt: 111 }
    ])
    expect(JSON.stringify(store)).not.toContain('raw-a')

    upsertUser(store, 'octo', 'raw-b', { now: 222 })
    expect(store.users).toHaveLength(1)
    expect(store.users[0].tokenHash).toBe(hashToken('raw-b'))
    expect(store.users[0].createdAt).toBe(111) // createdAt preserved on update
  })
})
