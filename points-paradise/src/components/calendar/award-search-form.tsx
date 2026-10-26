'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { searchAwardsAction, type SearchState } from '@/app/actions/search-actions'
import { CABINS, CABIN_LABELS } from '@/lib/domain/constants'
import { Button } from '../ui'

function shortDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      })
}

export function AwardSearchForm({
  defaults,
  homeAirports,
  destinationCount,
}: {
  defaults: {
    origin: string
    destination: string
    cabin: string
    startDate: string
    endDate: string
  }
  homeAirports: string[]
  destinationCount: number
}) {
  const [state, action, pending] = useActionState<SearchState, FormData>(searchAwardsAction, { error: null })
  const v = state.values ?? { ...defaults, includeHomeAirports: true }
  const others = homeAirports.filter((a) => a !== v.origin)
  return (
    <div>
      {/* Remount after each search so the fields show what was searched (React resets submitted forms). */}
      <form key={state.attempt ?? 0} action={action} className="grid gap-3 sm:grid-cols-6">
        <div>
          <label htmlFor="s-o" className="label">
            From
          </label>
          <input id="s-o" name="origin" defaultValue={v.origin} maxLength={3} className="field uppercase" required />
        </div>
        <div>
          <label htmlFor="s-d" className="label">
            To <span className="font-normal text-muted">(empty = anywhere)</span>
          </label>
          <input id="s-d" name="destination" defaultValue={v.destination} maxLength={3} placeholder="Anywhere" className="field uppercase placeholder:normal-case" />
        </div>
        {others.length > 0 && (
          <label className="flex items-center gap-2 text-sm sm:order-last sm:col-span-6">
            <input type="checkbox" name="includeHomeAirports" defaultChecked={v.includeHomeAirports} /> Also search from my other home airports ({others.join(', ')})
          </label>
        )}
        <div>
          <label htmlFor="s-c" className="label">
            Cabin
          </label>
          <select id="s-c" name="cabin" defaultValue={v.cabin} className="field">
            {CABINS.map((c) => (
              <option key={c} value={c}>
                {CABIN_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="s-s" className="label">
            From date
          </label>
          <input id="s-s" name="startDate" type="date" defaultValue={v.startDate} className="field" required />
        </div>
        <div>
          <label htmlFor="s-e" className="label">
            To date
          </label>
          <input id="s-e" name="endDate" type="date" defaultValue={v.endDate} className="field" required />
        </div>
        <div className="self-end">
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? 'Searching…' : 'Search awards'}
          </Button>
        </div>
        <p className="text-xs text-muted sm:order-last sm:col-span-6">
          Leave &ldquo;To&rdquo; empty to check {destinationCount} popular destinations plus your dream destinations at once (about 10 of your 1,000 daily seats.aero lookups).
        </p>
        {(state.error || state.ok) && (
          <p role={state.error ? 'alert' : 'status'} className={`text-sm sm:order-last sm:col-span-6 ${state.error ? 'text-danger' : 'text-ok'}`}>
            {state.error ?? state.ok}
          </p>
        )}
      </form>
      {state.results && state.results.length > 0 && (
        <ul className="mt-4 divide-y divide-line rounded-xl border border-line" aria-label="Search results">
          {state.results.map((r) => (
            <li key={r.dealId}>
              <Link href={`/deals/${r.dealId}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2.5 hover:bg-surface-2">
                <span>
                  <span className="font-semibold">
                    {r.city}
                    {r.country ? `, ${r.country}` : ''}
                  </span>{' '}
                  <span className="text-muted">
                    {r.origin} → {r.airport} · {shortDate(r.date)}
                    {r.direct ? ' · nonstop' : ''}
                  </span>
                </span>
                <span className="tabular text-sm">
                  <span className="font-semibold">{r.points.toLocaleString('en-US')} miles</span>
                  {r.taxesUsd != null ? ` + $${Math.round(r.taxesUsd)}` : ''} <span className="text-muted">· {r.airline}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
