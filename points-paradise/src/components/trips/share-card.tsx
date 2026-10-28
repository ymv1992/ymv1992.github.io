'use client'

import { useState, useTransition } from 'react'
import { shareTripAction } from '@/app/actions/trip-actions'
import { Button } from '../ui'

/** Turns the trip's read-only link on or off and makes it easy to copy. */
export function ShareCard({ tripId, initialToken, origin }: { tripId: string; initialToken: string | null; origin: string }) {
  const [token, setToken] = useState(initialToken)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const url = token ? `${origin}/share/${token}` : null

  const set = (on: boolean) =>
    start(async () => {
      try {
        const r = await shareTripAction(tripId, on)
        setToken(r.token)
        setCopied(false)
        setError(null)
      } catch {
        setError('Could not reach the site. Try again.')
      }
    })

  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted">
        Anyone with the link can see this trip, but can&rsquo;t change anything or see the rest of your site. They can also download it as a PDF.
      </p>
      {url ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input readOnly value={url} aria-label="Share link" className="field min-w-0 flex-1 text-xs" onFocus={(e) => e.currentTarget.select()} />
            <Button
              type="button"
              size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(url)
                  setCopied(true)
                } catch {
                  setCopied(false)
                }
              }}
            >
              {copied ? 'Copied' : 'Copy link'}
            </Button>
          </div>
          <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => set(false)}>
            {pending ? 'Turning off…' : 'Stop sharing'}
          </Button>
        </>
      ) : (
        <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => set(true)}>
          {pending ? 'Creating link…' : 'Create share link'}
        </Button>
      )}
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
