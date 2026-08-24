// Remote project helpers — implementation lives in @shared/remote-project so the
// renderer can use it too; this re-export keeps the core namespace surface.

export { isRemoteProject, remoteLabel, normalizeRemote } from '../shared/remote-project'
export type { ProjectRemote } from '../shared/types'
