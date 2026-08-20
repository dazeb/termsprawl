// Epoch-guarded worktree state (Phase 8, Task 8.3). Electron-free.
//
// A poller periodically asks git for `worktree list`. Because the responses are
// asynchronous, an out-of-order (stale) poll must never overwrite fresher state.
// Every reconcile carries a monotonic version; a version <= the last accepted
// version is dropped. The store also feeds the "scoped panel" — the git panel
// can target the main checkout or a bound worktree path.

import type { GitWorktree } from '../shared/types'

export interface ReconcileResult {
  accepted: boolean
  worktrees: GitWorktree[]
}

export class WorktreeStore {
  private version = 0
  private worktrees: GitWorktree[] = []

  /** Apply a poll result. Only versions strictly greater than the last
   * accepted version take effect; anything older/equal is dropped (the poller
   * laid the result over a newer snapshot). */
  reconcile(worktrees: GitWorktree[], version: number): ReconcileResult {
    if (version <= this.version) {
      return { accepted: false, worktrees: this.worktrees }
    }
    this.version = version
    this.worktrees = worktrees
    return { accepted: true, worktrees: this.worktrees }
  }

  get(): GitWorktree[] {
    return this.worktrees
  }

  /** Last accepted version. */
  versionOf(): number {
    return this.version
  }

  /** True when `path` is a tracked worktree (or the main checkout). */
  has(path: string): boolean {
    return this.worktrees.some((w) => w.path === path)
  }

  /** The tracked worktree at `path`, or undefined. */
  at(path: string): GitWorktree | undefined {
    return this.worktrees.find((w) => w.path === path)
  }
}