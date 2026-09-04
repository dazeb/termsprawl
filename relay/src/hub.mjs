// The WebSocket hub. Every socket must authenticate: hosts with a GitHub
// token (verified against the sha256 hash in the users store) or the dev
// bypass; clients with a single-use invite minted by their host. After
// pairing, both sides receive the peer's X25519 public key and all further
// traffic is opaque E2E envelopes — the hub routes { from, to, env } and
// never sees plaintext.
import { WebSocketServer } from 'ws'

import { StoreError, createInvite, redeemInvite, isInviteActive } from './store.mjs'
import { hashToken } from './github-auth.mjs'

const OFFLINE_QUEUE_CAP = 100

export class HubError extends Error {
  constructor(code, message = code) {
    super(message)
    this.name = 'HubError'
    this.code = code
  }
}

function send(ws, obj) {
  if (ws && ws.readyState === ws.OPEN) {
    try { ws.send(JSON.stringify(obj)) } catch { /* socket died mid-send */ }
  }
}

function sendErrorAndClose(ws, code) {
  send(ws, { t: 'error', code })
  try { ws.close() } catch { /* already gone */ }
}

export function createHub({ store, requireAuth = true, devAuth = false } = {}) {
  if (devAuth && process.env.NODE_ENV === 'production') {
    throw new HubError('DEV-AUTH-FORBIDDEN', 'devAuth bypass is forbidden when NODE_ENV=production')
  }

  const wss = new WebSocketServer({ noServer: true })

  /** host sessions: sessionKey ('<login>' or 'dev-<login>') → { ws, pub, login } */
  const hosts = new Map()
  /** client sessions: clientId ('client:<login>') → { ws, pub, login, inviteCode, hostSessionKey, queue } */
  const clients = new Map()

  const counters = { framesRelayed: 0, bytesRelayed: 0 }

  const connectedHosts = () => [...hosts.values()].filter((h) => h.ws && h.ws.readyState === h.ws.OPEN).length
  const connectedClients = () => [...clients.values()].filter((c) => c.ws && c.ws.readyState === c.ws.OPEN).length
  const bufferedTotal = () => [...clients.values()].reduce((n, c) => n + c.queue.length, 0)
  const activeInvites = () => store.invites.filter((inv) => isInviteActive(inv)).length

  function stats() {
    return {
      hosts: connectedHosts(),
      clients: connectedClients(),
      framesRelayed: counters.framesRelayed,
      bytesRelayed: counters.bytesRelayed,
      buffered: bufferedTotal(),
      invites: { active: activeInvites() }
    }
  }

  function handleUpgrade(req, socket, head) {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
  }

  wss.on('connection', (ws) => {
    /** auth state for THIS socket; set once a valid hello lands */
    let session = null // { kind: 'host'|'client', id, ... }

    ws.on('message', (raw) => {
      let msg
      try { msg = JSON.parse(raw.toString()) } catch {
        return sendErrorAndClose(ws, 'BADFRAME')
      }
      if (!msg || typeof msg !== 'object') return sendErrorAndClose(ws, 'BADFRAME')

      if (!session) {
        if (msg.t !== 'hello') return sendErrorAndClose(ws, 'AUTH') // auth required on every socket
        try { session = handleHello(ws, msg) } catch (err) {
          if (err instanceof StoreError) return sendErrorAndClose(ws, err.code)
          return sendErrorAndClose(ws, 'AUTH')
        }
        if (!session) return // hello failed; error already sent + socket closed
        return
      }
      try { routeFrame(session, ws, msg) } catch (err) {
        if (err instanceof HubError) send(ws, { t: 'error', code: err.code })
      }
    })

    ws.on('close', () => {
      if (!session) return
      if (session.kind === 'host') {
        // only remove if this socket is still the registered host
        const cur = hosts.get(session.id)
        if (cur && cur.ws === ws) hosts.delete(session.id)
      } else {
        // keep the client session for offline buffering + invite resume
        const cur = clients.get(session.id)
        if (cur && cur.ws === ws) cur.ws = null
      }
    })
    ws.on('error', () => { /* close handler does the cleanup */ })
  })

  // ------------------------------------------------------------------ hello

  function handleHello(ws, msg) {
    if (msg.role === 'host') return helloHost(ws, msg)
    if (msg.role === 'client') return helloClient(ws, msg)
    sendErrorAndClose(ws, 'BADROLE')
    return null
  }

  function helloHost(ws, msg) {
    let login = msg.login
    if (typeof login !== 'string' || !login) { sendErrorAndClose(ws, 'AUTH'); return null }

    if (!devAuth) {
      const user = store.users.find((u) => u.login === login)
      if (!requireAuth || !user || typeof msg.token !== 'string' || user.tokenHash !== hashToken(msg.token)) {
        sendErrorAndClose(ws, 'AUTH')
        return null
      }
    } else {
      login = 'dev-' + login
    }

    // a second host with the same login replaces the first
    const old = hosts.get('host:' + login)
    if (old && old.ws && old.ws !== ws) {
      send(old.ws, { t: 'error', code: 'REPLACED' })
      try { old.ws.close() } catch { /* gone */ }
    }

    const id = 'host:' + login
    const hostSession = { kind: 'host', id, login, ws, pub: msg.pub }
    hosts.set(id, hostSession)
    send(ws, { t: 'peers', peer: null }) // registered; no client paired yet
    return hostSession
  }

  function helloClient(ws, msg) {
    if (typeof msg.invite !== 'string' || !msg.invite) { sendErrorAndClose(ws, 'UNKNOWN'); return null }
    const login = typeof msg.login === 'string' && msg.login ? msg.login : msg.invite
    const clientId = 'client:' + login

    // Resume: an offline session for this exact client + invite (the invite
    // was already redeemed — do NOT redeem again).
    const existing = clients.get(clientId)
    if (existing && existing.inviteCode === msg.invite && existing !== null) {
      existing.ws = ws
      existing.pub = msg.pub
      pairAndAck(existing)
      flushQueue(existing)
      return existing
    }

    // Fresh pairing: redeem the invite (typed errors propagate).
    const inv = redeemInvite(store, msg.invite)

    // find the host session the invite belongs to (devAuth prefixes logins)
    const hostSession =
      hosts.get('host:' + inv.hostLogin) ?? hosts.get('host:dev-' + inv.hostLogin)
    if (!hostSession || !hostSession.ws || hostSession.ws.readyState !== hostSession.ws.OPEN) {
      sendErrorAndClose(ws, 'HOST-OFFLINE')
      return null
    }

    const clientSession = {
      kind: 'client',
      id: clientId,
      login,
      ws,
      pub: msg.pub,
      inviteCode: inv.code,
      hostSessionKey: hostSession.id,
      queue: []
    }
    clients.set(clientId, clientSession)
    pairAndAck(clientSession)
    return clientSession
  }

  /** send the peers frames so both sides can derive the shared key */
  function pairAndAck(clientSession) {
    const hostSession = hosts.get(clientSession.hostSessionKey)
    if (hostSession) {
      send(hostSession.ws, { t: 'peers', peer: { login: clientSession.login, pub: clientSession.pub } })
    }
    send(clientSession.ws, { t: 'peers', peer: { login: hostSession ? hostSession.login : clientSession.hostSessionKey, pub: hostSession ? hostSession.pub : null } })
  }

  function flushQueue(clientSession) {
    while (clientSession.queue.length > 0 && clientSession.ws) {
      const queued = clientSession.queue.shift()
      send(clientSession.ws, queued.msg)
    }
  }

  // ----------------------------------------------------------------- routing

  function routeFrame(session, ws, msg) {
    if (msg.t === 'frame' || msg.t === 'direct-offer') {
      deliver(session, msg)
      return
    }
    if (msg.t === 'invite-create') {
      // hosts only: mint an invite for their own account.
      if (session.kind !== 'host') return sendErrorAndClose(ws, 'AUTH')
      try {
        const invite = createInvite(store, session.login)
        send(ws, { t: 'invite', code: invite.code })
      } catch (err) {
        if (err instanceof StoreError) return send(ws, { t: 'error', code: err.code })
        throw err
      }
      return
    }
    throw new HubError('BADFRAME')
  }

  /** Route a frame/direct-offer from `session` to its recipient. */
  function deliver(session, msg) {
    const to = typeof msg.to === 'string' ? msg.to : ''
    const out = { ...msg, from: session.id }
    if (session.kind === 'host') {
      // host → client (or host → host)
      if (to.startsWith('client:')) {
        const target = clients.get(to)
        if (!target) throw new HubError('NOBODY-HOME')
        if (target.ws && target.ws.readyState === target.ws.OPEN) {
          counters.framesRelayed++
          counters.bytesRelayed += Buffer.byteLength(JSON.stringify(out))
          send(target.ws, out)
        } else {
          if (msg.t !== 'frame') throw new HubError('NOBODY-HOME') // buffering is for envelopes only
          target.queue.push({ msg: out })
          if (target.queue.length > OFFLINE_QUEUE_CAP) target.queue.shift()
          counters.framesRelayed++
          counters.bytesRelayed += Buffer.byteLength(JSON.stringify(out))
        }
        return
      }
      throw new HubError('NOBODY-HOME')
    }

    // client → its paired host
    const hostSession = hosts.get(session.hostSessionKey)
    if (!hostSession || !hostSession.ws || hostSession.ws.readyState !== hostSession.ws.OPEN) {
      throw new HubError('NOBODY-HOME')
    }
    counters.framesRelayed++
    counters.bytesRelayed += Buffer.byteLength(JSON.stringify(out))
    send(hostSession.ws, out)
  }

  return { wss, handleUpgrade, stats }
}
