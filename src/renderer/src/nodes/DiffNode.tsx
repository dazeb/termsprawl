import { useCallback, useEffect, useRef, useState } from 'react'
import { NodeResizer } from '@reactflow/node-resizer'
import type { NodeProps } from 'reactflow'
import { DiffEditor } from '@monaco-editor/react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { nodeTitle } from '../state/workspace'
import { detectLanguage } from '../monaco'
import { useCanvas } from '../canvas/Canvas'
import type { DiffNodeData } from '../state/workspace'
import type { DiffInfoResult } from '@shared/types'
import { useSafeResize } from '../hooks/useSafeResize'
import { HelpBadge } from '../components/HelpBadge'

// A read-only git diff: original side comes from the chosen ref (staged index
// or HEAD), modified side from the working tree. The path/base are persisted
// with the node; the diff payload is fetched on demand over IPC and kept in
// component state (never serialized).
export function DiffNode({ id, data, selected }: NodeProps<DiffNodeData>): React.JSX.Element {
  const { updateNodeData, closeNode } = useCanvas()
  // automaticLayout off + rAF-deferred layout (see EditorNode for the RO-loop
  // rationale): Monaco's internal observer re-triggers on fractional sizes.
  const hostRef = useRef<HTMLDivElement>(null)
  const diffEditorRef = useRef<MonacoEditor.IStandaloneDiffEditor | null>(null)
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

  // Drive the diff editor's layout on container resize, rAF-deferred.
  useSafeResize(hostRef, () => {
    diffEditorRef.current?.layout()
  })

  const status = info?.error?.message ?? null
  const original = info?.original ?? ''
  const modified = info?.modified ?? ''

  return (
    <div className="diff-node">
      <NodeResizer isVisible={selected} minWidth={400} minHeight={240} />
      <div className="diff-node-header">
        <span className="diff-node-title" title={data.path ?? undefined}>
          {nodeTitle(data)}
        </span>
        <HelpBadge
          label="about this diff"
          text="Read-only Monaco diff. Open picks a file; the toggle switches the left side between the git index (staged) and HEAD. Right side is always the working tree. Needs a git repo. Nothing here writes back to disk."
        />
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
          <div className="diff-host nodrag nowheel" ref={hostRef}>
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
                automaticLayout: false
              }}
              onMount={(editor) => {
                diffEditorRef.current = editor
              }}
            />
          </div>
        )}
        {status && <div className="diff-status">{status}</div>}
      </div>
    </div>
  )
}
