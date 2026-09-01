// Shared link anchors (Phase 18): every linkable node renders one source and
// one target Handle so links can be dragged between nodes. Invisible until the
// node (or an edge drag) is active — the canvas theme stays clean.
import { Handle, Position } from 'reactflow'

export function LinkHandles(): React.JSX.Element {
  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        className="link-handle"
        isConnectableStart={false}
      />
      <Handle type="source" position={Position.Right} className="link-handle" />
    </>
  )
}
