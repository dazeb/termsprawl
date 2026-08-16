// Session-name tracker (Phase 7, Task 7.4).
//
// Hook events arrive constantly (every tool call), but the transcript's
// session_name only changes when Claude starts or the user runs /rename. The
// tracker throttles transcript reads per session and reports a name only when
// it differs from the last reported one — so main broadcasts a session-name
// event exactly when the node title should change, and nothing otherwise.
// Electron-free; fail-open on unreadable transcripts.

import { readSessionNameFromTranscript } from './transcript'

interface SessionState {
  name: string | null
  lastRead: number
}

export interface SessionNameTrackerOptions {
  /** Minimum gap between transcript reads per session (ms). */
  throttleMs?: number
}

export class SessionNameTracker {
  private readonly throttleMs: number
  private readonly state = new Map<string, SessionState>()

  constructor(options: SessionNameTrackerOptions = {}) {
    this.throttleMs = options.throttleMs ?? 5_000
  }

  /**
   * Consider a transcript for a session. Returns the session name to broadcast
   * (string when new/changed, null when nothing to report: unchanged, throttled,
   * or unreadable).
   */
  note(sessionId: string, transcriptPath: string | undefined): string | null {
    if (!transcriptPath) return null
    const now = Date.now()
    const prev = this.state.get(sessionId)
    if (prev && now - prev.lastRead < this.throttleMs) return null

    const name = readSessionNameFromTranscript(transcriptPath)
    this.state.set(sessionId, { name, lastRead: now })
    if (!prev || prev.name !== name) return name
    return null
  }
}
