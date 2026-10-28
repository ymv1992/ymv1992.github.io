'use client'

import { useActionState } from 'react'
import { guestLogin, type GuestLoginState } from './actions'
import { Button } from '@/components/ui'

/** One-field sign-in for a friend who was sent a guest password. */
export function GuestLoginForm() {
  const [state, action, pending] = useActionState<GuestLoginState, FormData>(guestLogin, { error: null })
  return (
    <form action={action} className="mt-3 space-y-3" noValidate>
      <div>
        <label htmlFor="guestPassword" className="label">
          Guest password
        </label>
        <input id="guestPassword" name="guestPassword" autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="XXXX-XXXX-XXXX" required className="field tabular tracking-wider" />
      </div>
      {state.error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      <Button type="submit" variant="secondary" className="w-full" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in as a guest'}
      </Button>
      <p className="text-xs text-muted">A guest pass gives view-only access. Each sign-in lasts up to a day.</p>
    </form>
  )
}
