'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { findWeekendsAction, type WeekendState } from '@/app/actions/weekend-actions'
import { airlineNames, programUnit } from '@/lib/domain/airlines'
import { CABINS, CABIN_LABELS } from '@/lib/domain/constants'
import type { WeekendPick } from '@/lib/data/weekend-getaways'
import type { AwardSearchResultRow } from '@/lib/data/award-search'
import { seatsLabel } from '@/lib/search/compare'
import { Button } from '../ui'

const pts = (n: number) => n.toLocaleString('en-US')
const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })

function Leg({ label, r, seats }: { label: string; r: AwardSearchResultRow; seats: number }) {
  const s = seatsLabel(r.seats, seats)
  return (
    <Link href={`/deals/${r.dealId}`} className="block rounded-lg px-2 py-1 hover:bg-surface-2">
      <span className="font-medium text-ink">{label}:</span> {day(r.date)} · {r.origin} → {r.airport} · {pts(r.points)} {programUnit(r.programId)}
      {r.taxesUsd != null ? ` + $${Math.round(r.taxesUsd)}` : ''} · {airlineNames(r.airline)}
      {r.direct ? ' · nonstop' : ''}
      {r.bonus ? ` · +${r.bonus.percent}% bonus` : ''}
      {s ? <span className={r.seats == null ? ' text-warn' : ''}> · {s}</span> : null}
    </Link>
  )
}

function Pick({ p, seats, best }: { p: WeekendPick; seats: number; best: boolean }) {
  return (
    <li className={`rounded-xl border p-3 ${best ? 'border-ok/40 bg-ok-soft' : 'border-line bg-surface'}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="font-semibold">
          {p.city}
          {p.country ? <span className="font-normal text-muted">, {p.country}</span> : null}
          {p.miles ? <span className="text-xs font-normal text-muted"> · about {pts(p.miles)} mi</span> : null}
        </p>
        <p className="tabular text-sm">
          <span className="font-semibold">{p.chasePoints != null ? `${pts(p.chasePoints)} Chase pts` : `${pts(p.points)} points`}</span>
          {p.taxesUsd != null ? ` + $${Math.round(p.taxesUsd)}` : ''} <span className="text-xs text-muted">round trip, per person</span>
        </p>
      </div>
      <div className="mt-1 grid gap-0.5 text-xs text-muted sm:grid-cols-2">
        <Leg label="Out" r={p.out} seats={seats} />
        <Leg label="Back" r={p.back} seats={seats} />
      </div>
    </li>
  )
}

/** Award seats for weekend trips over the coming weekends, cheapest first. */
export function WeekendForm({ defaults, homeAirports }: { defaults: { origin: string }; homeAirports: string[] }) {
  const [state, action, pending] = useActionState<WeekendState, FormData>(findWeekendsAction, { error: null })
  const v = state.values ?? { origin: defaults.origin, includeHomeAirports: true, weeks: '8', shape: 'long', cabin: 'economy', seats: '1', maxMiles: '2500' }
  const others = homeAirports.filter((a) => a !== v.origin)
  const out = state.outcome
  const seats = Number(v.seats) || 1
  const withPicks = out?.windows.filter((w) => w.picks.length) ?? []
  const cheapest = withPicks.length ? Math.min(...withPicks.flatMap((w) => w.picks.map((p) => p.chasePoints ?? p.points))) : null
  return (
    <div>
      <form key={state.attempt ?? 0} action={action} className="grid gap-3 sm:grid-cols-6">
        <div>
          <label htmlFor="w-o" className="label">
            From
          </label>
          <input id="w-o" name="origin" defaultValue={v.origin} maxLength={3} required className="field uppercase" />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="w-s" className="label">
            Trip
          </label>
          <select id="w-s" name="shape" defaultValue={v.shape} className="field">
            <option value="long">Long weekend (Thu/Fri → Sun/Mon)</option>
            <option value="short">Weekend (Fri → Sun)</option>
          </select>
        </div>
        <div>
          <label htmlFor="w-w" className="label">
            Weekends
          </label>
          <select id="w-w" name="weeks" defaultValue={v.weeks} className="field">
            {[4, 8, 12].map((n) => (
              <option key={n} value={n}>
                Next {n}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="w-m" className="label">
            Flight length
          </label>
          <select id="w-m" name="maxMiles" defaultValue={v.maxMiles} className="field">
            <option value="1500">Short (up to about 3 hours)</option>
            <option value="2500">Medium (up to about 5 hours)</option>
            <option value="any">Any distance</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="w-c" className="label">
            Cabin
          </label>
          <select id="w-c" name="cabin" defaultValue={v.cabin} className="field">
            {CABINS.map((c) => (
              <option key={c} value={c}>
                {CABIN_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="w-n" className="label">
            Seats
          </label>
          <select id="w-n" name="seats" defaultValue={v.seats} className="field">
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n === 1 ? '1 person' : `${n} people`}
              </option>
            ))}
          </select>
        </div>
        <div className="self-end sm:col-span-3 sm:justify-self-end">
          <Button type="submit" disabled={pending} className="w-full sm:w-auto">
            {pending ? 'Searching…' : 'Find weekend getaways'}
          </Button>
        </div>
        {others.length > 0 && (
          <label className="flex items-center gap-2 text-sm sm:col-span-6">
            <input type="checkbox" name="includeHomeAirports" defaultChecked={v.includeHomeAirports} /> Also from my other home airports ({others.join(', ')})
          </label>
        )}
        <p className="text-xs text-muted sm:col-span-6">
          Checks every popular destination plus your dream destinations both ways (about 20 of your 1,000 daily seats.aero lookups). Award space is cached, and flight times aren&rsquo;t known yet — check the times
          with the airline before you transfer points.
        </p>
        {state.error && (
          <p role="alert" className="text-sm text-danger sm:col-span-6">
            {state.error}
          </p>
        )}
      </form>

      {out && (
        <div className="mt-5 space-y-5">
          <p role="status" className="text-sm text-ok">
            {withPicks.length
              ? `${out.destinations} destination${out.destinations === 1 ? '' : 's'} with seats both ways on at least one weekend.`
              : 'No weekend has award seats both ways for these settings. Try a long weekend, any distance, or more weekends.'}
            {out.hiddenForSeats ? ` ${out.hiddenForSeats} flight${out.hiddenForSeats === 1 ? '' : 's'} with fewer than ${seats} seats left ${out.hiddenForSeats === 1 ? 'was' : 'were'} left out.` : ''}
            {out.failed ? ` ${out.failed} of the searches failed; see Settings → Usage.` : ''}
            {out.truncated ? ' Some searches hit the result limit, so a few options may be missing.' : ''}
          </p>
          {out.windows.map((w) => (
            <section key={w.friday} aria-label={`Weekend of ${w.label}`}>
              <h3 className="mb-2 text-sm font-semibold">{w.label}</h3>
              {w.picks.length ? (
                <ul className="space-y-2">
                  {w.picks.map((p) => (
                    <Pick key={p.city} p={p} seats={seats} best={(p.chasePoints ?? p.points) === cheapest} />
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">No seats both ways this weekend.</p>
              )}
            </section>
          ))}
          {seats > 1 && <p className="text-xs text-muted">Points are per person — you need {seats}× for {seats} people.</p>}
        </div>
      )}
    </div>
  )
}
