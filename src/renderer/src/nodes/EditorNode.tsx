import { useCallback, useEffect, useRef, useState } from 'react'
import { NodeResizer } from '@reactflow/node-resizer'
import type { NodeProps } from 'reactflow'
import Editor from '@monaco-editor/react'
import type { editor as MonacoEditor } from 'monaco-editor'
import '../monaco'
import { monaco, detectLanguage } from '../monaco'
import { nodeTitle } from '../state/workspace'
import { useCanvas } from '../canvas/Canvas'
import type { EditorNodeData } from '../state/workspace'
import { renderMarkdown } from '../markdown'
import { toFilePreviewUrl } from '@shared/file-url'
import type { FileReadResult } from '@shared/types'
import { useSafeResize } from '../hooks/useSafeResize'
import { HelpBadge } from '../components/HelpBadge'

export function EditorNode({ id, data, selected }: NodeProps<EditorNodeData>): React.JSX.Element {
  const { updateNodeData, closeNode } = useCanvas()
  // Monaco's own `automaticLayout` uses a ResizeObserver that re-triggers
  // itself on fractional sizes (the "ResizeObserver loop completed with
  // undelivered notifications" warning on every node resize). We drive layout
  // ourselves: automaticLayout off + rAF-deferred layout on container resize.
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const [content, setContent] = useState('')
  const [saved, setSaved] = useState('')
  const [kind, setKind] = useState<'text' | 'markdown' | 'image' | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const saveRef = useRef<() => Promise<void>>(async () => {})

  const load = useCallback(async (path: string) => {
    setLoading(true)
    setStatus(null)
    try {
      const result: FileReadResult = await window.termsprawl.files.read(path)
      if ('error' in result) {
        setKind(null)
        setContent('')
        setSaved('')
        setStatus(result.error.message)
        return
      }
      if (result.kind === 'image') {
        setKind('image')
        setContent('')
        setSaved('')
        return
      }
      setKind(result.kind)
      setContent(result.content)
      setSaved(result.content)
    } catch (err) {
      setStatus(String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (data.path) void load(data.path)
    else {
      setKind(null)
      setContent('')
      setSaved('')
      setStatus(null)
    }
  }, [data.path, load])

  const dirty = kind !== 'image' && kind !== null && content !== saved

  const save = useCallback(async () => {
    if (!data.path || kind === 'image' || kind === null) return
    const result = await window.termsprawl.files.write(data.path, content)
    if ('error' in result) {
      setStatus(result.error.message)
      return
    }
    setSaved(content)
    setStatus(null)
  }, [content, data.path, kind])

  saveRef.current = save

  const openFile = useCallback(async () => {
    const path = await window.termsprawl.files.openDialog()
    if (path) updateNodeData(id, { path }, true)
  }, [id, updateNodeData])

  const togglePreview = useCallback(() => {
    updateNodeData(id, { preview: !data.preview }, true)
  }, [id, data.preview, updateNodeData])

  // Drive Monaco layout on container resize, rAF-deferred (no RO loop noise).
  useSafeResize(hostRef, () => {
    editorRef.current?.layout()
  })

  const showPreview = kind === 'markdown' && data.preview

  return (
    <div className="editor-node">
      <NodeResizer isVisible={selected} minWidth={240} minHeight={160} />
      <div className="editor-node-header">
        <span className="editor-node-title" title={data.path ?? undefined}>
          {nodeTitle(data)}
        </span>
        <HelpBadge
          label="about this editor"
          text="Opens a file from disk through the project-safe file service. Ctrl+S or save writes utf-8. The lime dot means unsaved. Markdown gets a preview toggle (raw HTML is stripped). Images preview in-place and are not editable here. Reopen the project and this node still points at the same path."
        />
        {dirty && (
          <span className="editor-dirty" title="Unsaved changes" aria-label="Unsaved changes" />
        )}
        {kind === 'markdown' && (
          <button
            className="node-action"
            onClick={togglePreview}
            title={data.preview ? 'Edit markdown' : 'Preview markdown'}
          >
            {data.preview ? 'edit' : 'preview'}
          </button>
        )}
        <button
          className="node-action"
          onClick={() => void save()}
          disabled={!dirty}
          title="Save (Ctrl+S)"
        >
          save
        </button>
        <button className="node-action" onClick={() => void openFile()} title="Open file">
          open
        </button>
        <button
          className="node-close"
          title="Close editor"
          aria-label="Close editor"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            closeNode(id)
          }}
        >
          ×
        </button>
      </div>
      <div className="editor-node-body">
        {!data.path ? (
          <div className="editor-empty">Open a file to edit</div>
        ) : loading && kind === null && !status ? (
          <div className="editor-empty">loading…</div>
        ) : kind === 'image' && data.path ? (
          <div className="editor-image-host nodrag nowheel">
            <img src={toFilePreviewUrl(data.path)} alt={nodeTitle(data)} />
          </div>
        ) : showPreview ? (
          <div
            className="editor-preview nodrag nowheel"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
          />
        ) : kind === 'text' || kind === 'markdown' ? (
          <div className="editor-host nodrag nowheel" ref={hostRef}>
            <Editor
              value={content}
              language={detectLanguage(data.path)}
              theme="vs-dark"
              onChange={(value) => setContent(value ?? '')}
              options={{
                minimap: { enabled: false },
                fontSize: 12,
                scrollBeyondLastLine: false,
                automaticLayout: false,
                wordWrap: 'on'
              }}
              onMount={(editor) => {
                editorRef.current = editor
                editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
                  void saveRef.current()
                })
              }}
            />
          </div>
        ) : (
          <div className="editor-empty">{status ?? 'nothing to show'}</div>
        )}
        {status && kind !== null && <div className="editor-status">{status}</div>}
      </div>
    </div>
  )
}
