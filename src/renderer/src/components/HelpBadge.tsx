import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const HIDE_MS = 160
const POP_WIDTH = 268

interface HelpBadgeProps {
  text: string
  label?: string
}

export function HelpBadge({ text, label = 'help' }: HelpBadgeProps): React.JSX.Element {
  const tipId = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  const cancelHide = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
  }, [])

  const place = useCallback(() => {
    const button = buttonRef.current
    if (!button) return
    const rect = button.getBoundingClientRect()
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - POP_WIDTH - 8))
    const below = rect.bottom + 6
    const top = below + 160 > window.innerHeight ? Math.max(8, rect.top - 8 - 140) : below
    setPos({ top, left })
  }, [])

  const show = useCallback(() => {
    cancelHide()
    place()
    setOpen(true)
  }, [cancelHide, place])

  const scheduleHide = useCallback(() => {
    cancelHide()
    hideTimer.current = setTimeout(() => setOpen(false), HIDE_MS)
  }, [cancelHide])

  useEffect(() => () => cancelHide(), [cancelHide])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onReposition = (): void => place()
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
    }
  }, [open, place])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="help-badge nodrag"
        aria-label={label}
        aria-describedby={open ? tipId : undefined}
        aria-expanded={open}
        onMouseEnter={show}
        onMouseLeave={scheduleHide}
        onFocus={show}
        onBlur={scheduleHide}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          event.preventDefault()
          if (open) {
            cancelHide()
            setOpen(false)
          } else {
            show()
          }
        }}
      >
        ?
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            id={tipId}
            role="tooltip"
            className="help-pop"
            style={{ top: pos.top, left: pos.left, width: POP_WIDTH }}
            onMouseEnter={show}
            onMouseLeave={scheduleHide}
          >
            {text}
          </div>,
          document.body
        )}
    </>
  )
}
