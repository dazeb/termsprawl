import type { WorkspaceStore } from './workspace-store'
import type { DurableCleanupResult } from '../shared/types'

interface ProjectDeletionStore extends Pick<
  WorkspaceStore,
  'snapshot' | 'deleteProject' | 'pendingTerminalIdsForProject' | 'completeTerminalCleanup'
> {}

export interface TerminalCleanupFailure {
  id: string
  error: unknown
}

/** Commit project removal before permanently destroying its terminal sessions. */
export function deleteProjectAndDestroyTerminals(
  store: ProjectDeletionStore,
  destroyTerminal: (id: string) => void,
  projectId: string,
  liveTerminalIds: Iterable<string> = []
): DurableCleanupResult {
  const snapshot = store.snapshot()
  const terminalIds = new Set<string>()
  for (const node of snapshot.projects[projectId] ?? []) {
    if (node.type === 'terminal') terminalIds.add(node.id)
  }
  for (const id of liveTerminalIds) terminalIds.add(id)
  for (const id of store.pendingTerminalIdsForProject(projectId)) terminalIds.add(id)

  store.deleteProject(projectId, [...terminalIds])
  const failures: TerminalCleanupFailure[] = []
  const completed: string[] = []
  for (const id of terminalIds) {
    try {
      destroyTerminal(id)
      completed.push(id)
    } catch (error) {
      failures.push({ id, error })
    }
  }
  try {
    store.completeTerminalCleanup(completed)
  } catch {
    return { committed: true, cleanupPendingIds: [...terminalIds] }
  }
  return { committed: true, cleanupPendingIds: failures.map((failure) => failure.id) }
}
