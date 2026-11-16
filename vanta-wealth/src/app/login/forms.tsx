'use client'

import { startTransition, useActionState } from 'react'
import { generateSetupValues, login, type LoginState, type SetupState } from './actions'
import { Button } from '@/components/ui'

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, { error: null })
  return (
    // Submitted by hand rather than through the form's action so React does not clear the fields after a failed attempt.
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        const data = new FormData(e.currentTarget)
        startTransition(() => action(data))
      }}
    >
      <input type="hidden" name="next" value={next} />
      <div>
        <label htmlFor="email" className="label">
          Email
        </label>
        <input id="email" name="email" type="email" autoComplete="username" required className="field" />
      </div>
      <div>
        <label htmlFor="password" className="label">
          Password
        </label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="field" />
      </div>
      {state.error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  )
}

function Copyable({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="label">{label}</p>
      <textarea readOnly value={value} rows={value.length > 60 ? 3 : 1} className="field num text-xs" onFocus={(e) => e.currentTarget.select()} />
    </div>
  )
}

export function SetupForm() {
  const [state, action, pending] = useActionState<SetupState, FormData>(generateSetupValues, { error: null })
  return (
    <div className="space-y-4">
      <form action={action} className="space-y-3">
        <div>
          <label htmlFor="passphrase" className="label">
            Choose a passphrase (12+ characters)
          </label>
          <input id="passphrase" name="passphrase" type="password" autoComplete="new-password" className="field" />
        </div>
        {state.error && (
          <p role="alert" className="text-sm text-danger">
            {state.error}
          </p>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? 'Working…' : 'Create my setup values'}
        </Button>
      </form>
      {state.hash && state.secret && (
        <div className="space-y-3 rounded-xl border border-line bg-surface-2 p-4">
          <p className="text-sm text-muted">Copy these into your hosting settings as environment variables, then redeploy. They are not saved anywhere and will not be shown again.</p>
          <Copyable label="OWNER_PASSWORD_HASH" value={state.hash} />
          <Copyable label="SESSION_SECRET" value={state.secret} />
        </div>
      )}
    </div>
  )
}
