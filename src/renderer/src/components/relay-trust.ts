/** Relay pairing-trust decision (A4). Encapsulates the rule that drives the
 * Settings → Relay confirm card: a peer is only treated as trusted after the
 * user eyeballs and confirms its key fingerprint, and that choice persists
 * across sessions in settings.relay.trustedFingerprint. Pure + Electron-free
 * so it can be unit tested in isolation from the settings sheet. */
export type TrustState = 'none' | 'confirm' | 'trusted' | 'mismatch'

/** Decide what to show given the persisted trusted fingerprint (undefined =
 * never trusted on this machine) and the fingerprint a fresh connect just
 * reported (null = no peer key yet, e.g. connecting before a peer is present).
 *  - none     — no peer key → show nothing (not yet paired with a peer).
 *  - confirm  — first pairing → ask the user to confirm this fingerprint.
 *  - trusted  — matches the persisted trust → connect silently, no card.
 *  - mismatch — the key changed vs the persisted fingerprint → hard warning,
 *               require an explicit re-trust (never auto-trust). */
export function trustState(trusted: string | undefined, peerFingerprint: string | null): TrustState {
  if (!peerFingerprint) return 'none'
  if (!trusted) return 'confirm'
  return trusted === peerFingerprint ? 'trusted' : 'mismatch'
}
