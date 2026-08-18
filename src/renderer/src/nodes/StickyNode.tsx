import { useRef } from 'react'
import type { NodeProps } from 'reactflow'
import { STICKY_COLORS, nodeTitle } from '../state/workspace'
import { useCanvas } from '../canvas/Canvas'
import type { StickyNodeData } from '../state/workspace'
import { HelpBadge } from '../components/HelpBadge'

// A colored note on the canvas: header (drag handle) with color dot + title
// + collapse toggle, and an always-editable textarea body. The body is
// nodrag/nowheel so text selection and scrolling work; dragging happens via
// the header, same as terminal nodes.
export function StickyNode({ id, data }: NodeProps<StickyNodeData>): React.JSX.Element {
  const { updateNodeData, commit, closeNode } = useCanvas()
  const blurTimer = useRef<number | null>(null)

  const cycleColor = (): void => {
    const next = STICKY_COLORS[(STICKY_COLORS.indexOf(data.color) + 1) % STICKY_COLORS.length]
    updateNodeData(id, { color: next }, true)
  }

  const toggleCollapsed = (): void => {
    updateNodeData(id, { collapsed: !data.collapsed }, true)
  }

  // One history snapshot per edit session: typing updates data without
  // recording, blur commits the final text.
  const commitOnBlur = (): void => {
    if (blurTimer.current !== null) window.clearTimeout(blurTimer.current)
    blurTimer.current = window.setTimeout(() => commit(), 50)
  }

  return (
    <div className={`sticky-node sticky-${data.color}${data.collapsed ? ' collapsed' : ''}`}>
      <div className="sticky-node-header">
        <button
          className="sticky-node-dot"
          onClick={cycleColor}
          title="Cycle color"
          aria-label="Cycle color"
        />
        <span className="sticky-node-title">{nodeTitle(data)}</span>
        <HelpBadge
          label="about this note"
          text="A scratch note on the canvas. Drag the header. The body is always editable — selection and scroll stay in the text. The color dot cycles slate / amber / lime / pink / cyan. Collapse hides the body. Saved with the project."
        />
        <button
          className="node-close"
          title="Close note"
          aria-label="Close note"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            closeNode(id)
          }}
        >
          ×
        </button>
        <button
          className="sticky-node-toggle"
          onClick={toggleCollapsed}
          title={data.collapsed ? 'Expand' : 'Collapse'}
          aria-label={data.collapsed ? 'Expand' : 'Collapse'}
        >
          {data.collapsed ? '▸' : '▾'}
        </button>
      </div>
      {!data.collapsed && (
        <textarea
          className="nodrag nowheel"
          value={data.text}
          placeholder="Write a note…"
          onChange={(e) => updateNodeData(id, { text: e.target.value }, false)}
          onBlur={commitOnBlur}
          spellCheck={false}
        />
      )}
    </div>
  )
}
