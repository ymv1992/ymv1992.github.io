'use client'

import { useActionState, useState, useTransition } from 'react'
import { refreshTripRateAction, setTripRateAction } from '@/app/actions/trip-actions'
import { currencyName, rateSourceLabel, type TripRate } from '@/lib/trips/money'
import type { FormState } from '../action-form'
import { Button } from '../ui'

function dateLabel(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

/** One currency: its locked rate, where it came from, your own rate, and "Update to today's rate". */
function RateRow({ tripId, code, rate }: { tripId: string; code: string; rate: TripRate | null }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setTripRateAction, { error: null })
  const [refreshing, start] = useTransition()
  const [note, setNote] = useState<{ ok: boolean; message: string } | null>(null)
  const id = `rate-${code}`
  return (
    <li className="space-y-2 py-3 first:pt-0 last:pb-0">
      <p className="font-semibold">
        {currencyName(code)} <span className="font-normal text-muted">({code})</span>
      </p>
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="tripId" value={tripId} />
        <input type="hidden" name="currency" value={code} />
        <label htmlFor={id} className="text-muted">
          1 USD =
        </label>
        {/* Keyed by the rate so the box shows a newly fetched rate, while this row (and its messages) stays. */}
        <input
          key={rate ? `${rate.perUsd}-${rate.asOf}` : 'none'}
          id={id}
          name="perUsd"
          inputMode="decimal"
          defaultValue={rate ? String(Number(rate.perUsd.toFixed(4))) : ''}
          placeholder="e.g. 152.5"
          className="field tabular"
          style={{ width: '7.5rem' }}
        />
        <span className="text-muted">{code}</span>
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          {pending ? 'Saving…' : 'Use my rate'}
        </Button>
      </form>
      <p className="text-xs text-muted">
        {rate ? `${rateSourceLabel(rate)} from ${dateLabel(rate.asOf)}. Locked until you change it.` : 'No rate yet, so these costs are not in the dollar total. Type a rate or get today’s.'}
      </p>
      <button
        type="button"
        disabled={refreshing}
        onClick={() =>
          start(async () => {
            try {
              setNote(await refreshTripRateAction(tripId, code))
            } catch {
              setNote({ ok: false, message: 'Could not reach the site. Try again.' })
            }
          })
        }
        className="text-xs text-primary underline-offset-2 hover:underline disabled:opacity-60"
      >
        {refreshing ? 'Getting today’s rate…' : rate ? 'Update to today’s rate' : 'Get today’s rate'}
      </button>
      {(state.error || state.ok || note) && (
        <p role={state.error || note?.ok === false ? 'alert' : 'status'} className={`text-xs ${state.error || note?.ok === false ? 'text-danger' : 'text-ok'}`}>
          {state.error ?? note?.message ?? state.ok}
        </p>
      )}
    </li>
  )
}

/** Exchange rates the trip uses to show local-currency costs in dollars. */
export function RatesCard({ tripId, currencies, rates }: { tripId: string; currencies: string[]; rates: Record<string, TripRate> }) {
  return (
    <ul className="divide-y divide-line text-sm">
      {currencies.map((c) => (
        <RateRow key={c} tripId={tripId} code={c} rate={rates[c] ?? null} />
      ))}
    </ul>
  )
}
