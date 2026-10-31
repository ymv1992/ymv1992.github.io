'use client'

import { useState, useTransition } from 'react'
import { lookUpTripFlightAction } from '@/app/actions/trip-actions'
import { bookingLines, bookingSource, bookingSummary, canLookUpFlight, type TripItemView } from '@/lib/trips/shared'

/**
 * The "Booking details" dropdown under a flight or stay: confirmation, times,
 * nights and aircraft. Flights with a number and airports can fill their
 * times and aircraft from Google Flights.
 */
export function BookingPanel({
  tripId,
  item,
  date,
  today,
  readOnly,
}: {
  tripId?: string
  item: Pick<TripItemView, 'id' | 'kind' | 'time' | 'booking' | 'title'>
  /** The item's trip date, if the trip has dates. */
  date: string | null
  today: string
  /** The shared page: no lookups, and confirmation numbers stay private. */
  readOnly?: boolean
}) {
  const [pending, start] = useTransition()
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const lines = bookingLines(item, date, { hideConfirmation: readOnly })
  const summary = bookingSummary(item)
  const canLookUp = !readOnly && !!tripId && canLookUpFlight(item, date, today)
  const looked = !!item.booking?.schedule
  if (!lines.length && !canLookUp) return null
  return (
    <details className="group mt-1.5 rounded-lg bg-surface-2/60 px-2.5 py-1.5 text-xs">
      <summary className="cursor-pointer list-none text-primary [&::-webkit-details-marker]:hidden">
        <span className="font-semibold">{item.kind === 'flight' ? 'Flight details' : item.kind === 'hotel' ? 'Stay details' : 'Booking details'}</span>
        {summary && <span className="text-muted"> · {summary}</span>} <span aria-hidden className="inline-block transition-transform group-open:rotate-180">▾</span>
      </summary>
      {lines.length > 0 && (
        <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
          {lines.map((l) => (
            <div key={l.label} className="contents">
              <dt className="text-muted">{l.label}</dt>
              <dd className={l.label === 'Confirmation' ? 'font-mono font-semibold tracking-wide' : ''}>
                {l.value}
                {l.note && <span className="block text-faint">{l.note}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {bookingSource(item) && <p className="mt-2 text-faint">{bookingSource(item)}</p>}
      {canLookUp && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                try {
                  const r = await lookUpTripFlightAction(tripId!, item.id)
                  setMessage({ ok: r.ok, text: r.message })
                } catch {
                  setMessage({ ok: false, text: 'Could not reach the site. Try again.' })
                }
              })
            }
            className="rounded-full border border-line bg-surface px-2.5 py-1 text-primary hover:bg-surface-2 disabled:opacity-60"
            title="Uses one of your monthly Google searches"
          >
            {pending ? 'Looking up…' : looked ? 'Check times & aircraft again' : 'Find times & aircraft'}
          </button>
          {message && (
            <span role={message.ok ? 'status' : 'alert'} className={message.ok ? 'text-ok' : 'text-danger'}>
              {message.text}
            </span>
          )}
        </div>
      )}
    </details>
  )
}
