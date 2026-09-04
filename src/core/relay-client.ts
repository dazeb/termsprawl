// Phase 11 Task 11.2 — app-side relay client seam. Electron-free (node:crypto
// only + an injectable WebSocket factory, so tests and the Server Edition can
// fake the socket). Speaks the relay's wire protocol and its exact envelope
// format: X25519 ECDH → HKDF-SHA256 → AES-256-GCM with the sender id as AAD.
// Nothing auto-connects: the app dials the relay only when asked. This is the
// seam — pairing UI + terminal frames over the tunnel are follow-ups.
//
// Clean-room: written fresh for termsprawl; nothing copied from the fork or
// any other project.

import {
  createHash,
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  hkdfSync,
  randomBytes,
  generateKeyPairSync
} from 'node:crypto'

const HKDF_INFO = Buffer.from('termsprawl-relay-v1', 'utf8')
const NONCE_BYTES = 12

export interface RelayKeypair {
  publicKey: string // raw base64
  privateKey: string // raw base64
}

export function generateRelayKeypair(): RelayKeypair {
  const { publicKey, privateKey } = generateKeyPairSync('x25519')
  const rawPub = publicKey.export({ type: 'spki', format: 'der' }).subarray(12) // strip SPKI header
  const rawPriv = privateKey.export({ type: 'pkcs8', format: 'der' }).subarray(16) // strip PKCS8 header
  return { publicKey: rawPub.toString('base64'), privateKey: rawPriv.toString('base64') }
}

export function deriveRelayKey(myPrivateB64: string, peerPublicB64: string): Buffer {
  const priv = createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), Buffer.from(myPrivateB64, 'base64')]),
    format: 'der',
    type: 'pkcs8'
  })
  const pub = createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b656e032100', 'hex'), Buffer.from(peerPublicB64, 'base64')]),
    format: 'der',
    type: 'spki'
  })
  const shared = diffieHellman({ privateKey: priv, publicKey: pub })
  return Buffer.from(hkdfSync('sha256', shared, Buffer.alloc(0), HKDF_INFO, 32))
}

export interface RelayEnvelope {
  n: string
  c: string
}

/** Seal with the SENDER id as AAD — the id the relay will attach as `from`. */
export function sealRelay(key: Buffer, plaintext: string, senderId: string): RelayEnvelope {
  const n = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, n)
  cipher.setAAD(Buffer.from(String(senderId), 'utf8'))
  const c = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final(), cipher.getAuthTag()])
  return { n: n.toString('base64'), c: c.toString('base64') }
}

/** Open with the sender id the relay attached (`msg.from`). */
export function openRelay(key: Buffer, sealed: RelayEnvelope, senderId: string): string {
  if (!sealed || typeof sealed.n !== 'string' || typeof sealed.c !== 'string') throw new Error('malformed envelope')
  const n = Buffer.from(sealed.n, 'base64')
  const all = Buffer.from(sealed.c, 'base64')
  if (n.length !== NONCE_BYTES || all.length < 16) throw new Error('malformed envelope')
  const decipher = createDecipheriv('aes-256-gcm', key, n)
  decipher.setAAD(Buffer.from(String(senderId), 'utf8'))
  decipher.setAuthTag(all.subarray(all.length - 16))
  return Buffer.concat([decipher.update(all.subarray(0, all.length - 16)), decipher.final()]).toString('utf8')
}

export function hashRelayToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex')
}

// A short human-readable identity for a peer's X25519 public key: the first
// 16 bytes of its SHA-256, rendered as 8 space-separated lowercase hex pairs.
// Good enough to eyeball-match a pairing in the UI without exposing the key.
export function relayFingerprint(peerPubB64: string): string {
  const re = /^[A-Za-z0-9+/]+={0,2}$/
  if (!peerPubB64 || !re.test(peerPubB64)) throw new Error('invalid relay public key')
  const raw = Buffer.from(peerPubB64, 'base64')
  if (raw.length !== 32) throw new Error('invalid relay public key')
  const digest = createHash('sha256').update(raw).digest().subarray(0, 16)
  const pairs: string[] = []
  for (let i = 0; i < digest.length; i += 2) pairs.push(digest.subarray(i, i + 2).toString('hex'))
  return pairs.join(' ')
}

// ---------------------------------------------------------------------------
// WebSocket seam (injectable)
// ---------------------------------------------------------------------------

export interface RelaySocket {
  send(data: string): void
  close(): void
  onMessage(cb: (data: string) => void): void
  onError(cb: (err: Error) => void): void
  /** Register a callback fired when the underlying socket closes. */
  onClose(cb: () => void): void
}

export type RelaySocketFactory = (url: string) => Promise<RelaySocket>

export interface RelayClientOptions {
  relayUrl: string
  role: 'host' | 'client'
  /** Host auth: the relay hashes and matches this against its stored hash. */
  githubToken?: string
  /** Host identity sent with hello (dev relays prefix it). */
  login?: string
  /** Client auth: a pre-minted single-use invite code. */
  invite?: string
  socketFactory: RelaySocketFactory
  log?(msg: string): void
}

export interface RelayPairing {
  peerPub: string | null
  peerLogin: string | null
  /** The sender id the relay assigns US (used as the envelope AAD). */
  selfId: string
}

export interface RelayClient {
  readonly keypair: RelayKeypair
  connect(): Promise<RelayPairing>
  /** Ask the relay to mint a fresh single-use invite code (host role). */ 
  mintInvite(): Promise<string>
  /** Seal + send an envelope to a peer id. senderId comes from the pairing. */
  sendFrame(pairing: RelayPairing, to: string, plaintext: string): void
  onFrame(cb: (pairing: RelayPairing, from: string, plaintext: string) => void): void
  /** Fired when the underlying socket closes (peer gone / transport down). */
  onClose(cb: () => void): void
  close(): void
}

interface RelayMsg {
  t?: string
  from?: string
  to?: string
  env?: RelayEnvelope
  peer?: { login?: string; pub?: string } | null
  code?: string
  login?: string
}

function waitFor(ws: RelaySocket, pred: (m: RelayMsg) => boolean, timeoutMs = 8000): Promise<RelayMsg> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('relay: timed out')), timeoutMs)
    ws.onMessage((data) => {
      let m: RelayMsg
      try {
        m = JSON.parse(data)
      } catch {
        return
      }
      if (pred(m)) {
        clearTimeout(timer)
        resolve(m)
      }
    })
    ws.onError((e) => {
      clearTimeout(timer)
      reject(e)
    })
  })
}

export async function createRelayClient(opts: RelayClientOptions): Promise<RelayClient> {
  const keypair = generateRelayKeypair()
  const ws = await opts.socketFactory(opts.relayUrl)
  let pairing: RelayPairing | null = null
  const closeHandlers: Array<() => void> = []
  ws.onClose(() => {
    for (const cb of closeHandlers.splice(0)) cb()
  })

  const client: RelayClient = {
    keypair,

    async connect(): Promise<RelayPairing> {
      const hello: Record<string, unknown> = { t: 'hello', role: opts.role, pub: keypair.publicKey }
      if (opts.role === 'host') {
        hello.login = opts.login ?? 'app-host'
        if (opts.githubToken) hello.token = opts.githubToken
      } else {
        hello.invite = opts.invite ?? ''
      }
      ws.send(JSON.stringify(hello))
      // The relay acks registration with peers(peer:null), then sends a filled
      // peers frame when the counterpart pairs. Host connects first in every
      // real flow, so wait for the FILLED frame there; a client pairing
      // triggers the host's filled frame.
      const res = await waitFor(
        ws,
        (m) => m.t === 'error' || (m.t === 'peers' && (opts.role === 'client' || m.peer != null))
      )
      if (res.t === 'error') throw new Error(`relay pairing failed: ${res.code ?? 'unknown'}`)
      // The relay assigns our id by role+login: host:<login> | client:<login>.
      // In dev relays login is prefixed with dev-; the peers frame's peer.login
      // reflects the relay-side identity of the PEER, ours is derivable from
      // what we sent (the relay tells the peer about us the same way).
      const selfId =
        opts.role === 'host'
          ? `host:${hello.login as string}`
          : `client:${(opts.login as string) ?? (opts.invite as string)}`
      pairing = {
        peerPub: res.peer?.pub ?? null,
        peerLogin: res.peer?.login ?? null,
        selfId
      }
      opts.log?.(`relay paired (role=${opts.role}, peer=${pairing.peerLogin ?? 'none'})`)
      return pairing
    },

    async mintInvite(): Promise<string> {
      ws.send(JSON.stringify({ t: 'invite-create' }))
      const res = await waitFor(ws, (m) => m.t === 'invite' || m.t === 'error')
      if (res.t === 'error') throw new Error(`relay invite failed: ${res.code ?? 'unknown'}`)
      if (!res.code) throw new Error('relay invite failed: missing code')
      return res.code
    },

    sendFrame(p: RelayPairing, to: string, plaintext: string): void {
      if (!p.peerPub) throw new Error('relay: no peer public key — cannot seal')
      const key = deriveRelayKey(keypair.privateKey, p.peerPub)
      ws.send(JSON.stringify({ t: 'frame', to, env: sealRelay(key, plaintext, p.selfId) }))
    },

    onFrame(cb: (p: RelayPairing, from: string, plaintext: string) => void): void {
      ws.onMessage((data) => {
        let m: RelayMsg
        try {
          m = JSON.parse(data)
        } catch {
          return
        }
        if (m.t !== 'frame' || !pairing || !pairing.peerPub) return
        const from = String(m.from ?? '')
        try {
          const key = deriveRelayKey(keypair.privateKey, pairing.peerPub)
          cb(pairing, from, openRelay(key, m.env as RelayEnvelope, from))
        } catch (e) {
          opts.log?.(`relay: dropped undecryptable frame from ${from}: ${(e as Error).message}`)
        }
      })
    },

    onClose(cb: () => void): void {
      closeHandlers.push(cb)
    },

    close(): void {
      ws.close()
    }
  }
  return client
}
