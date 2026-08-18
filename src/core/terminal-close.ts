import type { DurableCleanupResult } from '../shared/types'
import type { WorkspaceStore } from './workspace-store'

interface TerminalCloseStore extends Pick<
  WorkspaceStore,
  'stageTerminalNodeClose' | 'removeTerminalNode' | 'completeTerminalNodeClose'
> {}

/**
 * Stage is the durable commit point. Failures after it remain retryable from
 * workspace.json and therefore return a committed result instead of throwing.
 */
export function closeTerminalNode(
  store: TerminalCloseStore,
  destroyTerminal: (id: string) => void,
  projectId: string,
  terminalId: string
): DurableCleanupResult {
  store.stageTerminalNodeClose(projectId, terminalId)
  try {
    store.removeTerminalNode(projectId, terminalId)
    destroyTerminal(terminalId)
    store.completeTerminalNodeClose(projectId, terminalId)
    return { committed: true, cleanupPendingIds: [] }
  } catch {
    return { committed: true, cleanupPendingIds: [terminalId] }
  }
}
