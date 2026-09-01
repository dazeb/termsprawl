// Link auto-run scheduler (Phase 18): runs a link after its source goes quiet
// for a debounce gap. Main knows the link list (project file) and receives
// dirty signals from PTY activity + renderer marks; per-link timers coalesce
// bursts. Epoch-guarded via dispose() so a project switch cancels pending runs.
import type { NodeLink } from '@shared/types'

export interface LinkSchedulerOptions {
  /** Quiet gap before a dirty link actually runs. */
  gapMs?: number
}

export class LinkScheduler {
  private links = new Map<string, NodeLink>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private inFlight = new Set<string>()
  /** Dirty sources seen before their links were known (boot race); replayed on setLinks. */
  private pendingDirty = new Set<string>()
  private disposed = false

  constructor(
    private readonly onRun: (linkId: string) => Promise<void>,
    private readonly options: LinkSchedulerOptions = {}
  ) {}

  private get gapMs(): number {
    return this.options.gapMs ?? 3000
  }

  /** Replace the known link list (on project load / link edit). */
  setLinks(links: NodeLink[]): void {
    if (this.disposed) return
    this.links = new Map(links.map((l) => [l.id, l]))
    // Drop timers for links that vanished.
    for (const id of [...this.timers.keys()]) {
      if (!this.links.has(id)) this.clearTimer(id)
    }
    // Replay dirty sources that arrived before the link list did (boot race).
    for (const sourceId of this.pendingDirty) this.markDirty(sourceId)
    this.pendingDirty.clear()
  }

  /** A source's content changed — schedule its auto links. */
  markDirty(sourceId: string, link?: NodeLink): void {
    if (this.disposed) return
    if (link) {
      if (link.source === sourceId && link.auto) this.schedule(link.id)
      return
    }
    const candidates = [...this.links.values()]
    if (candidates.length === 0) {
      // Link list not loaded yet — remember the source for setLinks to replay.
      this.pendingDirty.add(sourceId)
      return
    }
    let known = false
    for (const l of candidates) {
      if (l.source === sourceId) {
        known = true
        if (l.auto) this.schedule(l.id)
      }
    }
    if (!known) this.pendingDirty.add(sourceId)
  }

  private schedule(linkId: string): void {
    if (this.disposed) return
    this.clearTimer(linkId)
    const timer = setTimeout(() => {
      this.timers.delete(linkId)
      void this.run(linkId)
    }, this.gapMs)
    this.timers.set(linkId, timer)
  }

  private clearTimer(linkId: string): void {
    const timer = this.timers.get(linkId)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(linkId)
    }
  }

  private async run(linkId: string): Promise<void> {
    // One run per link at a time: a dirty during a run re-arms afterwards.
    if (this.inFlight.has(linkId)) {
      this.schedule(linkId)
      return
    }
    this.inFlight.add(linkId)
    try {
      await this.onRun(linkId)
    } catch {
      // Fail-open: a broken link must never break the scheduler.
    } finally {
      this.inFlight.delete(linkId)
    }
  }

  /** Cancel every pending run (project switch / shutdown). */
  dispose(): void {
    this.disposed = true
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }
}
