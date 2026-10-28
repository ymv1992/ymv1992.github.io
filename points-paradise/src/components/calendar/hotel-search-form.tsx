'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { searchHotelsAction, type HotelSearchState } from '@/app/actions/search-actions'
import { Button } from '../ui'

const PROGRAMS = [
  { id: 'hyatt', label: 'Hyatt' },
  { id: 'marriott', label: 'Marriott' },
  { id: 'ihg', label: 'IHG' },
  { id: 'wyndham', label: 'Wyndham' },
] as const

function shortDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

/** Hotel award search through rooms.aero: a place, a check-in date range and a stay length. */
export function HotelSearchForm({ defaults }: { defaults: { startDate: string; endDate: string; nights: number } }) {
  const [state, action, pending] = useActionState<HotelSearchState, FormData>(searchHotelsAction, { error: null })
  const v = state.values ?? { place: '', startDate: defaults.startDate, endDate: defaults.endDate, nights: String(defaults.nights), programs: PROGRAMS.map((p) => p.id) }
  return (
    <div>
      {/* Remount after each search so the fields show what was searched (React resets submitted forms). */}
      <form key={state.attempt ?? 0} action={action} className="grid gap-3 sm:grid-cols-6">
        <div className="sm:col-span-2">
          <label htmlFor="h-p" className="label">
            Where
          </label>
          <input id="h-p" name="place" defaultValue={v.place} placeholder="Maui, Paris, Bali…" className="field" required maxLength={80} />
        </div>
        <div>
          <label htmlFor="h-s" className="label">
            Check-in from
          </label>
          <input id="h-s" name="startDate" type="date" defaultValue={v.startDate} className="field" required />
        </div>
        <div>
          <label htmlFor="h-e" className="label">
            Check-in by
          </label>
          <input id="h-e" name="endDate" type="date" defaultValue={v.endDate} className="field" required />
        </div>
        <div>
          <label htmlFor="h-n" className="label">
            Nights
          </label>
          <select id="h-n" name="nights" defaultValue={v.nights} className="field">
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <div className="self-end">
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? 'Searching…' : 'Search hotels'}
          </Button>
        </div>
        <fieldset className="flex flex-wrap gap-x-4 gap-y-2 text-sm sm:col-span-6">
          <legend className="sr-only">Hotel programs</legend>
          {PROGRAMS.map((p) => (
            <label key={p.id} className="flex items-center gap-2">
              <input type="checkbox" name="programs" value={p.id} defaultChecked={v.programs.includes(p.id)} /> {p.label}
            </label>
          ))}
        </fieldset>
        <p className="text-xs text-muted sm:col-span-6">
          Finds award nights at Chase hotel partners with the hotel&rsquo;s cash rate for the same stay, so each result shows its value. One rooms.aero lookup per search (1,000 a day, included
          with seats.aero Pro).
        </p>
        {(state.error || state.ok) && (
          <p role={state.error ? 'alert' : 'status'} className={`text-sm sm:col-span-6 ${state.error ? 'text-danger' : 'text-ok'}`}>
            {state.error ?? state.ok}
          </p>
        )}
      </form>
      {state.results && state.results.length > 0 && (
        <ul className="mt-4 divide-y divide-line rounded-xl border border-line" aria-label="Hotel results">
          {state.results.map((r) => (
            <li key={r.dealId}>
              <Link href={`/deals/${r.dealId}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2.5 hover:bg-surface-2">
                <span>
                  <span className="font-semibold">{r.hotel}</span>{' '}
                  <span className="text-muted">
                    {r.city}
                    {r.country ? `, ${r.country}` : ''} · {shortDate(r.checkIn)} · {r.nights} night{r.nights === 1 ? '' : 's'}
                    {r.room === 'suite' ? ' · suite' : ''}
                  </span>
                </span>
                <span className="tabular text-sm">
                  <span className="font-semibold">{(r.chasePoints ?? r.points).toLocaleString('en-US')} Chase pts</span>
                  {r.cashUsd != null ? <span className="text-muted"> · ${Math.round(r.cashUsd).toLocaleString('en-US')} cash</span> : null}
                  {r.cpp != null ? <span className="font-semibold text-ok"> · {r.cpp.toFixed(2)}¢/pt</span> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
