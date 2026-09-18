import React, { useLayoutEffect, useRef, type ReactNode } from 'react'
import { agentConfig, agentIds, agentName, type AgentId } from '@shared/agents/config'
import claude from '../assets/agents/claude.svg'
import openai from '../assets/agents/openai.svg'
import grok from '../assets/agents/grok.svg'
import antigravity from '../assets/agents/antigravity.svg'
import opencode from '../assets/agents/opencode.svg'

const logos: Partial<Record<AgentId, string>> = { claude, codex: openai, grok, gemini: antigravity, opencode }

export function AgentMenuItems({ onSelect }: { onSelect: (id: AgentId) => void }): ReactNode {
  return <div className="context-section" role="group" aria-label="Open agent">
    <div className="context-section-label">Open agent</div>
    {agentIds().filter((id) => agentConfig(id).enabled).map((id) => (
      <button key={id} role="menuitem" onClick={() => onSelect(id)}>
        {logos[id]
          ? <span className="agent-menu-logo" aria-hidden="true" style={{ maskImage: `url(${JSON.stringify(logos[id])})`, WebkitMaskImage: `url(${JSON.stringify(logos[id])})` }} />
          : <span className="agent-menu-monogram" aria-hidden="true">{id === 'openclaude' ? 'OC' : '>_'}</span>}
        {agentName(id)}
      </button>
    ))}
  </div>
}

/** Keep the full action list reachable at every canvas edge and window size. */
export function CanvasMenu({ x, y, onClose, children }: {
  x: number; y: number; onClose: () => void; children: ReactNode
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useLayoutEffect(() => {
    const element = ref.current!
    const position = (): void => {
      const bounds = element.getBoundingClientRect()
      element.style.left = `${Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8))}px`
      element.style.top = `${Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8))}px`
    }
    position()
    const observer = new ResizeObserver(position)
    observer.observe(element)
    window.addEventListener('resize', position)
    return () => { observer.disconnect(); window.removeEventListener('resize', position) }
  }, [x, y])
  useLayoutEffect(() => {
    const element = ref.current!
    const previous = document.activeElement as HTMLElement | null
    element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const dismiss = (event: PointerEvent): void => {
      if (!element.contains(event.target as Node)) closeRef.current()
    }
    document.addEventListener('pointerdown', dismiss)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      if (element.contains(document.activeElement)) previous?.focus()
    }
  }, [x, y])
  return <div ref={ref} className="context-menu nowheel" role="menu" aria-label="Canvas actions"
    style={{ left: x, top: y }} onClick={(event) => event.stopPropagation()}
    onKeyDown={(event) => {
      event.stopPropagation()
      if (event.key === 'Escape' || event.key === 'Tab') { closeRef.current(); return }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const buttons = Array.from(ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
      buttons[next]?.focus()
    }}>{children}</div>
}
