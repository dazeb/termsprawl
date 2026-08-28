// GitHub device-flow OAuth (RFC 8628) + token storage. All network calls go
// through an injectable fetchFn; sleeps through an injectable sleepFn — tests
// script both. Raw tokens are never persisted: only sha256 hashes.
import crypto from 'node:crypto'

const DEVICE_CODE_URL = 'https://github.com/login/device/code'
const TOKEN_URL = 'https://github.com/login/oauth/access_token'
const USER_URL = 'https://api.github.com/user'

export class GithubAuthError extends Error {
  constructor(code, message = code) {
    super(message)
    this.name = 'GithubAuthError'
    this.code = code
  }
}

const enc = (s) => encodeURIComponent(s)

/** Step 1: ask GitHub for a device + user code. */
export async function startDeviceFlow({ clientId, fetchFn = fetch, clientSecret } = {}) {
  const body = `client_id=${enc(clientId)}`
  const opts = {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  }
  if (clientSecret) opts.body += `&client_secret=${enc(clientSecret)}`

  const res = await fetchFn(DEVICE_CODE_URL, opts)
  const data = await res.json()
  if (!res.ok || data.error) {
    throw new GithubAuthError(data.error ?? 'GITHUB', data.error_description ?? 'device code request failed')
  }
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri ?? 'https://github.com/login/device',
    interval: data.interval ?? 5,
    expiresInSeconds: data.expires_in ?? 900
  }
}

/**
 * Step 2: poll for the access token. authorization_pending keeps polling
 * (honoring the interval); slow_down adds 5s to every subsequent poll.
 * Success → { accessToken }. Hard errors throw; giving up throws { code: 'TIMEOUT' }.
 */
export async function pollForToken({ clientId, deviceCode, interval = 5, fetchFn = fetch, sleepFn = (ms) => new Promise((r) => setTimeout(r, ms)), maxAttempts = 60, clientSecret } = {}) {
  let delay = interval * 1000
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const body =
      `client_id=${enc(clientId)}` +
      `&device_code=${enc(deviceCode)}` +
      // grant_type is a fixed URN sent literally (GitHub's documented form)
      `&grant_type=urn:ietf:params:oauth:grant-type:device_code`
    const opts = {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    }
    if (clientSecret) opts.body += `&client_secret=${enc(clientSecret)}`

    const res = await fetchFn(TOKEN_URL, opts)
    const data = await res.json()

    if (data.access_token) return { accessToken: data.access_token }
    if (data.error === 'authorization_pending') {
      await sleepFn(delay)
      continue
    }
    if (data.error === 'slow_down') {
      // Back off at the current rate, then add 5s to every subsequent poll.
      await sleepFn(delay)
      delay += 5000
      continue
    }
    throw new GithubAuthError(data.error ?? 'GITHUB', data.error_description ?? 'token request failed')
  }
  throw new GithubAuthError('TIMEOUT', 'device flow did not complete in time')
}

/** Step 3: resolve an access token to a GitHub login. */
export async function fetchLogin({ accessToken, fetchFn = fetch } = {}) {
  const res = await fetchFn(USER_URL, {
    method: 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`
    }
  })
  const data = await res.json()
  if (!res.ok || !data.login) {
    throw new GithubAuthError('GITHUB', data.message ?? 'could not fetch user')
  }
  return data.login
}

/** sha256 hex of a raw token — this is the ONLY form ever persisted. */
export function hashToken(raw) {
  return crypto.createHash('sha256').update(String(raw), 'utf8').digest('hex')
}

/** Create or update a user record; stores tokenHash, never the raw token. */
export function upsertUser(store, login, rawToken, { now = Date.now() } = {}) {
  const tokenHash = hashToken(rawToken)
  const existing = store.users.find((u) => u.login === login)
  if (existing) {
    existing.tokenHash = tokenHash
    return existing
  }
  const user = { login, tokenHash, createdAt: now }
  store.users.push(user)
  return user
}
