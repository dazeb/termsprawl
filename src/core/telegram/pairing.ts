// Phase 11 — Telegram pairing. Pure allowlist logic, electron-free.
// Secure by default (docs/OWN-WORK.md §A concept): nothing works until the
// chat is paired. An EMPTY allowlist means "pair the first chat that says
// /start" (owner onboarding); a non-empty list only admits listed chats.

export type PairingDecision = 'allowed' | 'pair-me' | 'denied'

/** Decide what a chat may do. pair-me only when the allowlist is empty (the
 * very first contact becomes the owner). */
export function pairingDecision(chatId: number, allowedChatIds: string[]): PairingDecision {
  if (allowedChatIds.includes(String(chatId))) return 'allowed'
  return allowedChatIds.length === 0 ? 'pair-me' : 'denied'
}

/** Add a chat id to the allowlist (deduped). Returns the new list. */
export function addPairedChat(allowedChatIds: string[], chatId: number): string[] {
  const id = String(chatId)
  return allowedChatIds.includes(id) ? [...allowedChatIds] : [...allowedChatIds, id]
}
