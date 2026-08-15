import { useCallback, useEffect, useState } from 'react'
import type { NodeProps } from 'reactflow'
import { DiffEditor } from '@monaco-editor/react'
import { nodeTitle } from '../state/workspace'
import { detectLanguage } from '../monaco'
import { useCanvas } from '../canvas/Canvas'
import type { DiffNodeData } from '../state/workspace'
import type { DiffInfoResult } from '@shared/types'

// A read-only git diff: original side comes from the chosen ref (staged index
// or HEAD), modified side from the working tree. The path/base are persisted
// with the node; the diff payload is fetched on demand over IPC and kept in
// component state (never serialized).
export function DiffNode({ id, data }: NodeProps<DiffNodeData>): React.JSX.Element {
  const { updateNodeData, closeNode } = useCanvas()
  const [info, setInfo] = useState<DiffInfoResult | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(
    async (path: string, base: 'staged' | 'HEAD') => {
      setLoading(true)
      try {
        setInfo(await window.termsprawl.diff.info(path, base))
      } catch (err) {
        console.error('[diff] info failed:', err)
        setInfo({ original: null, modified: null, error: { code: 'IO', message: String(err) } })
      } finally {
        setLoading(false)
      }
    },
    []
  )

  useEffect(() => {
    if (data.path) void load(data.path, data.base)
    else setInfo(null)
  }, [data.path, data.base, load])

  const openFile = useCallback(async () => {
    const path = await window.termsprawl.files.openDialog()
    if (path) updateNodeData(id, { path }, true)
  }, [id, updateNodeData])

  const toggleBase = useCallback(() => {
    updateNodeData(id, { base: data.base === 'staged' ? 'HEAD' : 'staged' }, true)
  }, [id, data.base, updateNodeData])

  const status = info?.error?.message ?? null
  const original = info?.original ?? ''
  const modified = info?.modified ?? ''

  return (
    <div className="diff-node">
      <div className="diff-node-header">
        <span className="diff-node-title" title={data.path ?? undefined}>
          {nodeTitle(data)}
        </span>
        <button
          className="diff-toggle"
          onClick={toggleBase}
          disabled={!data.path}
          title="Toggle diff base"
        >
          {data.base === 'staged' ? 'staged' : 'HEAD'}
        </button>
        <button className="node-action" onClick={openFile} title="Open file to diff">
          open
        </button>
        <button
          className="node-close"
          title="Close diff"
          aria-label="Close diff"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            closeNode(id)
          }}
        >
          ×
        </button>
      </div>
      <div className="diff-node-body">
        {!data.path ? (
          <div className="diff-empty">Open a file to diff</div>
        ) : loading && !info ? (
          <div className="diff-empty">loading…</div>
        ) : (
          <div className="diff-host nodrag nowheel">
            <DiffEditor
              original={original}
              modified={modified}
              language={detectLanguage(data.path)}
              theme="vs-dark"
              options={{
                readOnly: true,
                renderSideBySide: true,
                minimap: { enabled: false },
                fontSize: 12,
                scrollBeyondLastLine: false,
                automaticLayout: true
              }}
            />
          </div>
        )}
        {status && <div className="diff-status">{status}</div>}
      </div>
    </div>
  )
}
