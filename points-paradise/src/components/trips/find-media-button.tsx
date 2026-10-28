'use client'

import { useState, useTransition } from 'react'
import { findTripMediaAction } from '@/app/actions/trip-actions'
import { Button } from '../ui'

/** Looks up maps and photos for places added before they existed (a few at a time). */
export function FindMediaButton({ tripId, count }: { tripId: string; count: number }) {
  const [pending, start] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2 text-sm">
      <span className="text-muted">
        {count} place{count === 1 ? '' : 's'} in this trip {count === 1 ? "doesn't" : "don't"} have a map or photo yet.
      </span>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            try {
              const r = await findTripMediaAction(tripId)
              setMessage(`Found ${r.maps} map${r.maps === 1 ? '' : 's'} and ${r.photos} photo${r.photos === 1 ? '' : 's'}.${r.remaining ? ' Press again for the rest.' : ''}`)
            } catch {
              setMessage('Could not reach the site. Try again.')
            }
          })
        }
      >
        {pending ? 'Looking up…' : 'Find maps & photos'}
      </Button>
      {message && (
        <span role="status" className="text-ok">
          {message}
        </span>
      )}
    </div>
  )
}
