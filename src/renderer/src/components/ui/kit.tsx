import React from 'react'
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes
} from 'react'

/* ---------------------------------------------------------------------------
   Settings control kit — the component system for the settings panel
   (AppSettingsPanel.tsx). Neutral by design: no lime anywhere; emphasis is
   ink-on-page, red is reserved for destructive states. Styled entirely with
   Tailwind v4 utilities (see src/renderer/src/settings.css for the tokens).

   Conventions: 32px control height (comfortable desktop hit targets), 7px
   radius on controls, 8px on cards, focus rings in ink via :focus-visible.
   ------------------------------------------------------------------------- */

export function Section({ title, children }: { title?: string; children: ReactNode }): React.JSX.Element {
  return (
    <section className="flex flex-col gap-2">
      {title && (
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mute">{title}</h2>
      )}
      {children}
    </section>
  )
}

/** Label + sub-copy on the left, control(s) on the right — the workhorse row. */
export function PrefRow({
  label,
  sub,
  children,
  className = ''
}: {
  label: ReactNode
  sub?: ReactNode
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div className={`flex items-center justify-between gap-4 border-b border-edge py-2.5 ${className}`}>
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-ink">{label}</div>
        {sub && <div className="mt-0.5 text-[11px] leading-snug text-mute">{sub}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}

/** Generic list row (accounts, A2A peers, API providers, cloud rows). */
export function Row({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="flex items-center gap-2 border-b border-edge py-2 text-[13px]">{children}</div>
}

/** New-item form row (add account / peer / provider). */
export function FieldRow({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="mt-3 flex gap-2">{children}</div>
}

export type ButtonVariant = 'neutral' | 'primary' | 'danger'
export type ButtonSize = 'md' | 'sm'

/** Action button. primary = solid ink (the only loud surface in the panel);
 * danger rests neutral and turns red on hover, armed = red resting
 * (destructive confirmations). md = 32px (settings rows), sm = 28px (dense
 * surfaces like the onboarding card). */
export function Button({
  variant = 'neutral',
  size = 'md',
  armed = false,
  className = '',
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  armed?: boolean
}): React.JSX.Element {
  const variantClass: Record<ButtonVariant, string> = {
    neutral: 'border-edge bg-panel text-ink hover:border-raised hover:bg-raised',
    primary: 'border-ink bg-ink text-page hover:opacity-90',
    danger: armed
      ? 'border-danger text-danger'
      : 'border-edge bg-transparent text-ink hover:border-danger hover:text-danger'
  }
  const sizeClass: Record<ButtonSize, string> = {
    md: 'h-8 px-3.5 text-[13px]',
    sm: 'h-7 px-3 text-xs'
  }
  return (
    <button
      type={type}
      className={`inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-[7px] border font-sans font-medium leading-none tracking-[0.01em] transition-colors duration-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink disabled:cursor-default disabled:opacity-45 ${sizeClass[size]} ${variantClass[variant]} ${className}`}
      {...rest}
    />
  )
}

/** Switch-style toggle (role=switch) — replaces the raw checkbox. */
export function Toggle({
  checked,
  onChange,
  disabled,
  ariaLabel,
  title
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  ariaLabel?: string
  title?: string
}): React.JSX.Element {
  const trackClass = checked ? 'border-ink bg-ink' : 'border-edge bg-panel'
  const knobClass = checked ? 'left-[18px] bg-page' : 'left-[3px] bg-mute'
  return (
    <button
      role="switch"
      type="button"
      onClick={() => onChange(!checked)}
      aria-checked={checked}
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
      className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-default disabled:opacity-45 ${trackClass}`}
    >
      <span
        className={`absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full transition-[left] duration-150 ${knobClass}`}
      />
    </button>
  )
}

/** Select with a custom chevron (appearance:none kills the GTK arrow). */
export function Select({
  className = '',
  selectClassName = '',
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { selectClassName?: string }): React.JSX.Element {
  return (
    <div className={`relative shrink-0 ${className}`}>
      <select
        className={`h-8 min-w-0 appearance-none rounded-[7px] border border-edge bg-panel py-1 pl-2.5 pr-8 font-sans text-[13px] text-ink transition-colors hover:border-raised focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink ${selectClassName}`}
        {...props}
      >
        {children}
      </select>
      <svg
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-mute"
        width="10"
        height="6"
        viewBox="0 0 10 6"
        fill="none"
        aria-hidden="true"
      >
        <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

/** Text / password input (prose, Geist sans). `grow` fills its row (form
 * rows); default caps at 280px for pref-row values. */
export function TextInput({
  className = '',
  grow = false,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { grow?: boolean }): React.JSX.Element {
  return (
    <input
      className={`h-8 min-w-0 rounded-[7px] border border-edge bg-panel px-2.5 font-sans text-[13px] text-ink transition-colors placeholder:text-mute hover:border-raised focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink ${
        grow ? 'max-w-none flex-1' : 'max-w-[280px] shrink'
      } ${className}`}
      {...props}
    />
  )
}

/** Multi-line input. */
export function TextArea({
  className = '',
  grow = false,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { grow?: boolean }): React.JSX.Element {
  return (
    <textarea
      className={`min-w-0 resize-y rounded-[7px] border border-edge bg-panel px-2.5 py-2 font-sans text-[13px] leading-snug text-ink transition-colors placeholder:text-mute hover:border-raised focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink ${
        grow ? 'max-w-none flex-1' : 'max-w-[280px] shrink'
      } ${className}`}
      {...props}
    />
  )
}

/** Raised block for status cards (relay pairing, remote terminals). */
export function Card({
  title,
  sub,
  danger = false,
  children,
  className = ''
}: {
  title?: ReactNode
  sub?: ReactNode
  danger?: boolean
  children?: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div
      className={`flex flex-col gap-2 rounded-lg border p-3 ${danger ? 'border-danger bg-danger/5' : 'border-edge bg-panel'} ${className}`}
    >
      {title !== undefined && (
        <div className={`text-[13px] font-medium ${danger ? 'text-danger' : 'text-ink'}`}>{title}</div>
      )}
      {sub !== undefined && <div className="text-[11px] leading-snug text-mute">{sub}</div>}
      {children}
    </div>
  )
}

/** Paragraph hint copy. */
export function Hint({ children, className = '' }: { children: ReactNode; className?: string }): React.JSX.Element {
  return <p className={`mb-2.5 text-[11px] leading-snug text-mute ${className}`}>{children}</p>
}

/** Small mono value text (ids, endpoints, sizes). */
export function Status({ children, className = '' }: { children: ReactNode; className?: string }): React.JSX.Element {
  return <span className={`font-mono text-[11px] text-mute ${className}`}>{children}</span>
}
