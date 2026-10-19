'use client'

import { useActionState, type ReactNode } from 'react'
import { Button } from './ui'

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
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>
  children: ReactNode
  submitLabel?: string
  className?: string
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, { error: null })
  return (
    <form action={formAction} className={className}>
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : submitLabel}
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
