'use client'

import { useActionState, useSyncExternalStore, type ReactNode } from 'react'
import { useFormStatus } from 'react-dom'
import { Button, cx } from './ui'

export interface FormState {
  error: string | null
  ok?: string
}

/** Form bound to a server action, with pending state and an accessible status line. */
export function ActionForm({
  action,
  children,
  submitLabel = 'Save',
  className = 'space-y-4',
  variant = 'primary',
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>
  children: ReactNode
  submitLabel?: string
  className?: string
  variant?: 'primary' | 'secondary'
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, { error: null })
  return (
    <form action={formAction} className={className}>
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant={variant} disabled={pending}>
          {pending ? 'Working…' : submitLabel}
        </Button>
        {state.error && (
          <span role="alert" className="text-sm text-danger">
            {state.error}
          </span>
        )}
        {state.ok && (
          <span role="status" className="text-sm text-ok">
            {state.ok}
          </span>
        )}
      </div>
    </form>
  )
}

function SubmitInner({ label, pendingLabel, variant, size, confirm }: { label: ReactNode; pendingLabel?: string; variant: 'primary' | 'secondary' | 'ghost' | 'danger'; size: 'sm' | 'md'; confirm?: string }) {
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      disabled={pending}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault()
      }}
    >
      {pending ? (pendingLabel ?? 'Working…') : label}
    </Button>
  )
}

/** One-button form for simple actions (refresh, delete, confirm). */
export function ActionButton({
  action,
  label,
  pendingLabel,
  variant = 'secondary',
  size = 'sm',
  confirm,
  hidden,
}: {
  action: (formData: FormData) => Promise<void>
  label: ReactNode
  pendingLabel?: string
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  confirm?: string
  hidden?: Record<string, string>
}) {
  return (
    <form action={action} className="inline-flex">
      {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <SubmitInner label={label} pendingLabel={pendingLabel} variant={variant} size={size} confirm={confirm} />
    </form>
  )
}

type Theme = 'dark' | 'light'
const listeners = new Set<() => void>()
function readTheme(): Theme {
  try {
    return localStorage.getItem('vw-theme') === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    readTheme,
    () => 'dark' as Theme,
  )
  const next: Theme = theme === 'dark' ? 'light' : 'dark'
  return (
    <button
      type="button"
      onClick={() => {
        try {
          localStorage.setItem('vw-theme', next)
        } catch {
          // Storage may be unavailable (private mode); the change still applies to this page.
        }
        document.documentElement.classList.toggle('dark', next === 'dark')
        listeners.forEach((l) => l())
      }}
      className={cx('rounded-full border border-line px-3 py-1 text-xs text-muted hover:bg-surface-2 hover:text-ink')}
      aria-label={`Switch to ${next} mode`}
    >
      {theme === 'dark' ? 'Light mode' : 'Dark mode'}
    </button>
  )
}
