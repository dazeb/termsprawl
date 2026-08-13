// Debounced undo/redo over the React Flow nodes array.
// Snapshots are taken on settle (after a drag/edit pause), not on every tick.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Node } from 'reactflow'
import type { SprawlNodeData } from './workspace'

const SNAPSHOT_DEBOUNCE_MS = 400

export function useHistory(
  nodes: Node<SprawlNodeData>[],
  setNodes: (updater: Node<SprawlNodeData>[] | ((prev: Node<SprawlNodeData>[]) => Node<SprawlNodeData>[])) => void
): {
  push: () => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
} {
  const [past, setPast] = useState<Node<SprawlNodeData>[][]>([])
  const [future, setFuture] = useState<Node<SprawlNodeData>[][]>([])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skipRef = useRef(false)

  const push = useCallback(() => {
    setPast((p) => [...p.slice(-49), nodes])
    setFuture([])
  }, [nodes])

  // Debounced auto-push on node changes that settle.
  useEffect(() => {
    if (skipRef.current) {
      skipRef.current = false
      return
    }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(push, SNAPSHOT_DEBOUNCE_MS)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [nodes, push])

  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p
      const prev = p[p.length - 1]
      setFuture((f) => [...f, nodes])
      skipRef.current = true
      setNodes(prev)
      return p.slice(0, -1)
    })
  }, [nodes, setNodes])

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f
      const next = f[f.length - 1]
      setPast((p) => [...p, nodes])
      skipRef.current = true
      setNodes(next)
      return f.slice(0, -1)
    })
  }, [nodes, setNodes])

  return { push, undo, redo, canUndo: past.length > 0, canRedo: future.length > 0 }
}
