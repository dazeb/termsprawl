// End-to-end envelope crypto for the relay. Key agreement is X25519 ECDH +
// HKDF-SHA256; traffic is AES-256-GCM. The relay only ever sees sealed
// envelopes { n, c } — keys and plaintexts live on the peers.
import crypto from 'node:crypto'

const HKDF_INFO = 'termsprawl-relay-v1'
const NONCE_BYTES = 12

/** Generate an X25519 key pair; both halves exported as raw base64. */
export function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519')
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).subarray(12).toString('base64'),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).subarray(16).toString('base64')
  }
}

function importRawPublic(rawB64) {
  const raw = Buffer.from(rawB64, 'base64')
  if (raw.length !== 32) throw new Error('invalid x25519 public key length')
  // SPKI wrapper for a 32-byte raw x25519 public key
  const spki = Buffer.concat([Buffer.from('302a300506032b656e032100', 'hex'), raw])
  return crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' })
}

function importRawPrivate(rawB64) {
  const raw = Buffer.from(rawB64, 'base64')
  if (raw.length !== 32) throw new Error('invalid x25519 private key length')
  // PKCS#8 wrapper for a 32-byte raw x25519 private key
  const pkcs8 = Buffer.concat([
    Buffer.from('302e020100300506032b656e04220420', 'hex'),
    raw
  ])
  return crypto.createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' })
}

/** ECDH(myPrivate, peerPublic) → HKDF-SHA256 → 32-byte AES key. */
export function deriveSharedKey(myPrivateB64, peerPublicB64) {
  const priv = importRawPrivate(myPrivateB64)
  const pub = importRawPublic(peerPublicB64)
  const shared = crypto.diffieHellman({ privateKey: priv, publicKey: pub })
  return Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.alloc(0), HKDF_INFO, 32))
}

/** AES-256-GCM seal: { n } = 12-byte random nonce b64, { c } = ciphertext+tag b64. */
export function seal(key, plaintextString, fromId) {
  const keyBytes = Buffer.isBuffer(key) ? key : Buffer.from(key)
  if (keyBytes.length !== 32) throw new Error('shared key must be 32 bytes')
  const n = crypto.randomBytes(NONCE_BYTES)
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBytes, n)
  cipher.setAAD(Buffer.from(String(fromId), 'utf8'))
  const c = Buffer.concat([cipher.update(String(plaintextString), 'utf8'), cipher.final(), cipher.getAuthTag()])
  return { n: n.toString('base64'), c: c.toString('base64') }
}

/** AES-256-GCM open; tampering or key/sender mismatch throws. */
export function open(key, sealed, fromId) {
  const keyBytes = Buffer.isBuffer(key) ? key : Buffer.from(key)
  if (keyBytes.length !== 32) throw new Error('shared key must be 32 bytes')
  if (!sealed || typeof sealed.n !== 'string' || typeof sealed.c !== 'string') {
    throw new Error('malformed envelope')
  }
  const n = Buffer.from(sealed.n, 'base64')
  const all = Buffer.from(sealed.c, 'base64')
  if (n.length !== NONCE_BYTES || all.length < 16) throw new Error('malformed envelope')
  const c = all.subarray(0, all.length - 16)
  const tag = all.subarray(all.length - 16)
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBytes, n)
  decipher.setAAD(Buffer.from(String(fromId), 'utf8'))
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(c), decipher.final()]).toString('utf8')
}
