'use client'

import { useActionState, useState } from 'react'
import { createGuestPassAction, type GuestPassState } from '@/app/actions/settings-actions'
import { Button } from '../ui'

/** Creates a guest pass and shows its password once, with what to send the friend. */
export function GuestPassForm() {
  const [state, action, pending] = useActionState<GuestPassState, FormData>(createGuestPassAction, { error: null })
  const [copiedFor, setCopiedFor] = useState<number | null>(null)
  const created = state.created
  const copied = copiedFor != null && copiedFor === state.attempt
  // Only shown after a pass is created in the browser, so this never runs during server rendering.
  const origin = created && typeof window !== 'undefined' ? window.location.origin : ''

  return (
    <div className="space-y-4">
      <form key={state.attempt ?? 0} action={action} className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <div>
          <label htmlFor="gp-label" className="label">
            Who is it for? <span className="text-faint">(optional)</span>
          </label>
          <input id="gp-label" name="label" maxLength={40} placeholder="e.g. Sam" className="field" />
        </div>
        <div>
          <label htmlFor="gp-logins" className="label">
            Sign-ins allowed
          </label>
          <select id="gp-logins" name="loginsAllowed" defaultValue="3" className="field">
            {[1, 2, 3, 4, 5, 10].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        {/* Before the button on phones; on wider screens it moves under the row. */}
        <label className="flex items-center gap-2 text-sm sm:order-last sm:col-span-3">
          <input type="checkbox" name="allowSearch" /> Let them run flight and hotel searches on the Award Calendar (uses your free seats.aero lookups)
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create guest pass'}
        </Button>
        {state.error && (
          <p role="alert" className="text-sm text-danger sm:order-last sm:col-span-3">
            {state.error}
          </p>
        )}
      </form>
      {created && (
        <div role="status" className="rounded-xl border border-ok/40 bg-ok-soft/40 p-4 text-sm">
          <p className="font-semibold">Guest pass for {created.label} is ready</p>
          <p className="mt-2 text-muted">Send them these two things. The password is shown only now, so copy it before leaving this page.</p>
          <dl className="mt-3 space-y-2">
            <div>
              <dt className="text-xs text-muted">Website</dt>
              <dd className="font-medium break-all">{origin || 'your site address'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Guest password</dt>
              <dd className="flex flex-wrap items-center gap-3">
                <code className="tabular rounded-lg bg-surface px-3 py-1.5 text-lg tracking-wider">{created.password}</code>
                <button
                  type="button"
                  className="rounded-full border border-line bg-surface px-3 py-1 text-xs"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(`${origin}\nGuest password: ${created.password}`)
                      setCopiedFor(state.attempt ?? null)
                    } catch {
                      setCopiedFor(null)
                    }
                  }}
                >
                  {copied ? 'Copied' : 'Copy both'}
                </button>
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted">
            On the sign-in page they tap <strong>Have a guest pass?</strong> and enter the password. It works {created.loginsAllowed} time
            {created.loginsAllowed === 1 ? '' : 's'}; each sign-in lasts up to a day. {created.allowSearch ? 'They can run searches.' : 'Everything is view-only.'}
          </p>
        </div>
      )}
    </div>
  )
}
