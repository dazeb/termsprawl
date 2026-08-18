import { useState } from 'react'
import type { NodeProps } from 'reactflow'
import { nodeTitle } from '../state/workspace'
import { useCanvas } from '../canvas/Canvas'
import type { GroupNodeData } from '../state/workspace'
import { HelpBadge } from '../components/HelpBadge'

// A parent frame around other nodes. The frame itself is the drag handle —
// React Flow moves children (parentId) along with it. The label pill is
// editable on double-click; edits commit one history snapshot on blur/Enter.
export function GroupNode({ id, data }: NodeProps<GroupNodeData>): React.JSX.Element {
  const { updateNodeData, commit, closeNode } = useCanvas()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(data.title)

  const startEdit = (): void => {
    setDraft(data.title)
    setEditing(true)
  }

  const commitEdit = (): void => {
    setEditing(false)
    const title = draft.trim()
    if (title && title !== data.title) {
      updateNodeData(id, { title }, true)
    } else {
      commit() // blur still closes the undo gap even if unchanged
    }
  }

  return (
    <div className="group-node">
      <div
        className="group-label nodrag"
        onDoubleClick={(e) => {
          e.stopPropagation()
          startEdit()
        }}
      >
        {editing ? (
          <input
            className="nodrag nowheel group-label-input"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitEdit()
              if (e.key === 'Escape') setEditing(false)
            }}
            onPointerDown={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="group-label-text">{nodeTitle(data)}</span>
        )}
        <HelpBadge
          label="about this group"
          text="A frame around other nodes. Drag the frame to move every child with it. Double-click the name to rename. Close ungroups — children stay on the canvas at the same place. Right-click a selection to wrap nodes in a new group."
        />
        <button
          className="node-close"
          title="Close group (ungroups children)"
          aria-label="Close group"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            closeNode(id)
          }}
        >
          ×
        </button>
      </div>
    </div>
  )
}
