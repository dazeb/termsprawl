// Link inspector (Phase 18): a popover shown when a node-link edge is
// selected. Edit the link kind / options, run it now, or delete it. Styling
// follows the HelpBadge popover family; in-app confirms only.
import React, { useState } from 'react'
import type { LinkConfig, LinkKind, NodeLink } from '@shared/types'
import { linkDefaultConfig, LINK_SOURCES } from '../../../core/links/registry'

export interface LinkInspectorProps {
  link: NodeLink
  /** Source node kind — gates which link kinds stay valid. */
  sourceKind: string
  /** Target node kind ('a2a-peer' for peer links). */
  targetKind: string
  onChange(patch: Partial<Pick<NodeLink, 'kind' | 'auto' | 'config' | 'label'>>): void
  onRun(): void
  onDelete(): void
  onClose(): void
  /** Set by the canvas while a manual run is in flight. */
  running?: boolean
}

const KIND_OPTIONS: Array<{ kind: LinkKind; label: string }> = [
  { kind: 'file-output', label: 'Write to file' },
  { kind: 'context-inject', label: 'Inject context' },
  { kind: 'a2a-peer', label: 'Send to A2A peer' }
]

export function LinkInspector(props: LinkInspectorProps): React.JSX.Element {
  const { link, sourceKind, onChange, onRun, onDelete, onClose } = props
  const [confirmDelete, setConfirmDelete] = useState(false)
  const kinds = validKinds(sourceKind, props.targetKind)

  const lastRun = link.lastRun

  return (
    <div className="link-inspector nodrag nopan" onClick={(e) => e.stopPropagation()}>
      <div className="link-inspector-head">
        <span className="link-inspector-title">link</span>
        <button className="link-inspector-close" onClick={onClose} title="Close (Esc)">
          ×
        </button>
      </div>

      <label className="link-inspector-field">
        <span>label (optional)</span>
        <input
          type="text"
          value={link.label ?? ''}
          placeholder="name this link"
          maxLength={60}
          onChange={(e) => {
            const label = e.target.value.slice(0, 60)
            onChange({ label: label.length > 0 ? label : undefined })
          }}
        />
      </label>

      <label className="link-inspector-field">
        <span>behavior</span>
        <select
          value={link.kind}
          onChange={(e) => {
            const kind = e.target.value as LinkKind
            onChange({ kind, config: linkDefaultConfig(kind) })
          }}
        >
          {kinds.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>
      </label>

      {link.kind === 'file-output' && (
        <>
          <label className="link-inspector-field">
            <span>file path (relative to project)</span>
            <input
              type="text"
              value={link.config.kind === 'file-output' ? link.config.path : ''}
              placeholder=".termsprawl/outputs/<node>.md"
              onChange={(e) =>
                link.config.kind === 'file-output' &&
                onChange({ config: { ...link.config, path: e.target.value } })
              }
            />
          </label>
          <label className="link-inspector-field">
            <span>mode</span>
            <select
              value={link.config.kind === 'file-output' ? link.config.mode : 'overwrite'}
              onChange={(e) =>
                link.config.kind === 'file-output' &&
                onChange({
                  config: { ...link.config, mode: e.target.value as 'overwrite' | 'append' }
                })
              }
            >
              <option value="overwrite">overwrite</option>
              <option value="append">append</option>
            </select>
          </label>
          <label className="link-inspector-check">
            <input
              type="checkbox"
              checked={link.config.kind === 'file-output' ? link.config.header : false}
              onChange={(e) =>
                link.config.kind === 'file-output' &&
                onChange({ config: { ...link.config, header: e.target.checked } })
              }
            />
            <span>timestamp header</span>
          </label>
        </>
      )}

      {link.kind === 'context-inject' && (
        <>
          {props.targetKind === 'chat' && <label className="link-inspector-check">
            <input
              type="checkbox"
              checked={link.config.kind === 'context-inject' ? link.config.wrapper : true}
              onChange={(e) =>
                link.config.kind === 'context-inject' &&
                onChange({ config: { ...link.config, wrapper: e.target.checked } })
              }
            />
            <span>wrap with source title</span>
          </label>}
          {props.targetKind === 'terminal' && <label className="link-inspector-check">
            <input
              type="checkbox"
              checked={link.config.kind === 'context-inject' ? link.config.pastePointer : true}
              onChange={(e) =>
                link.config.kind === 'context-inject' &&
                onChange({ config: { ...link.config, pastePointer: e.target.checked } })
              }
            />
            <span>paste pointer line into terminal</span>
          </label>}
        </>
      )}

      {link.kind === 'a2a-peer' && (
        <>
          {sourceKind === 'chat' ? <label className="link-inspector-field">
            <span>payload</span>
            <select
              value={link.config.kind === 'a2a-peer' ? link.config.message : 'last-output'}
              onChange={(e) =>
                link.config.kind === 'a2a-peer' &&
                onChange({
                  config: {
                    ...link.config,
                    message: e.target.value as 'last-output' | 'full-capture'
                  }
                })
              }
            >
              <option value="last-output">latest assistant reply</option>
              <option value="full-capture">full conversation</option>
            </select>
          </label> : <p>Terminal sources send a bounded capture of the current pane, not a structured conversation.</p>}
          <label className="link-inspector-check">
            <input
              type="checkbox"
              checked={link.config.kind === 'a2a-peer' ? link.config.deliverReply : false}
              onChange={(e) =>
                link.config.kind === 'a2a-peer' &&
                onChange({ config: { ...link.config, deliverReply: e.target.checked } })
              }
            />
            <span>deliver reply back here</span>
          </label>
        </>
      )}

      <label className="link-inspector-check">
        <input
          type="checkbox"
          checked={link.auto}
          onChange={(e) => onChange({ auto: e.target.checked })}
        />
        <span>run automatically when content changes</span>
      </label>

      <div className="link-inspector-actions">
        <button className="settings-btn accent" onClick={onRun} disabled={props.running}>
          {props.running ? 'running…' : 'Run now'}
        </button>
        {confirmDelete ? (
          <button
            className="settings-btn danger armed"
            onClick={() => {
              onDelete()
            }}
          >
            confirm delete
          </button>
        ) : (
          <button className="settings-btn danger" onClick={() => setConfirmDelete(true)}>
            delete
          </button>
        )}
      </div>

      {lastRun && (
        <div className={`link-inspector-lastrun ${lastRun.ok ? 'ok' : 'err'}`}>
          {lastRun.ok ? '✓' : '✗'} {lastRun.summary}
        </div>
      )}
    </div>
  )
}

/** Kinds this source→target pair may carry (mirrors the canvas connect rules). */
function validKinds(sourceKind: string, targetKind: string): Array<{ kind: LinkKind; label: string }> {
  const out: Array<{ kind: LinkKind; label: string }> = []
  if (LINK_SOURCES['file-output'].includes(sourceKind)) {
    out.push(KIND_OPTIONS[0])
    if (targetKind === 'chat' || targetKind === 'terminal') out.push(KIND_OPTIONS[1])
  }
  if (targetKind === 'a2a-peer' && LINK_SOURCES['a2a-peer'].includes(sourceKind)) {
    out.push(KIND_OPTIONS[2])
  }
  return out
}

// Re-exported for tests.
export { linkDefaultConfig }
export type { LinkConfig }
