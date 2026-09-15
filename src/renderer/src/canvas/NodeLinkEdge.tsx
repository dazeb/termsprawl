// Custom edge for node links (Phase 18): standard bezier with a small kind
// chip at the midpoint (file / ctx / a2a) and a lime highlight when selected.
// Task 2.3: an optional user-facing NAME renders as a DOM overlay via
// EdgeLabelRenderer (stays readable at any zoom, unlike SVG-in-canvas text).
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from 'reactflow'

const KIND_LABEL: Record<string, string> = {
  'file-output': 'file',
  'context-inject': 'ctx',
  'a2a-peer': 'a2a'
}

export function NodeLinkEdge(props: EdgeProps): React.JSX.Element {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected } = props
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition
  })
  const kind = typeof data?.kind === 'string' ? data.kind : ''
  const name = typeof data?.label === 'string' && data.label.trim().length > 0 ? data.label : null
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: selected ? '#c6f135' : '#4a4a48',
          strokeWidth: selected ? 2 : 1.5
        }}
      />
      <EdgeLabelRenderer>
        {name && (
          <div
            className={`nodelink-label-dom nodrag nopan${selected ? ' selected' : ''}`}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`
            }}
          >
            {name}
          </div>
        )}
      </EdgeLabelRenderer>
      <g className="nodelink-label" transform={`translate(${labelX},${labelY})`}>
        <rect
          x={-16}
          y={-9}
          width={32}
          height={18}
          rx={9}
          className={`nodelink-chip kind-${kind}${selected ? ' selected' : ''}`}
        />
        <text textAnchor="middle" dominantBaseline="central" className="nodelink-chip-text">
          {KIND_LABEL[kind] ?? kind}
        </text>
      </g>
    </>
  )
}
