'use client'

import { useActionState, useState } from 'react'
import { searchAwardsAction, type SearchState, type SearchValues } from '@/app/actions/search-actions'
import type { AwardLegResult } from '@/lib/data/award-search'
import { AWARD_AIRLINES, AWARD_PROGRAMS } from '@/lib/domain/airlines'
import { CABINS, CABIN_LABELS } from '@/lib/domain/constants'
import { Button } from '../ui'
import { BonusNotes, CompareTable, ResultList, RoundTripSummary } from './award-results'

const SEAT_CHOICES = [1, 2, 3, 4]

export function AwardSearchForm({
  defaults,
  homeAirports,
  destinationCount,
  canPrice,
}: {
  defaults: {
    origin: string
    destination: string
    cabin: string
    startDate: string
    endDate: string
    returnStart: string
    returnEnd: string
  }
  homeAirports: string[]
  destinationCount: number
  /** A SerpApi key is configured, so cash prices can be looked up. */
  canPrice: boolean
}) {
  const [state, action, pending] = useActionState<SearchState, FormData>(searchAwardsAction, { error: null })
  const v: SearchValues = state.values ?? { ...defaults, tripType: 'one_way', seats: '1', includeHomeAirports: true, airline: '', program: '' }
  const [tripType, setTripType] = useState<SearchValues['tripType']>(v.tripType)
  const roundTrip = tripType === 'round_trip'
  const others = homeAirports.filter((a) => a !== v.origin)
  const out = state.outcome
  const allRows = out ? [...out.results, ...(out.returnLeg?.results ?? [])] : []

  return (
    <div>
      {/* Remount after each search so the fields show what was searched (React resets submitted forms). */}
      <form key={state.attempt ?? 0} action={action} className="grid gap-3 sm:grid-cols-6">
        <fieldset className="sm:col-span-6">
          <legend className="sr-only">Trip type</legend>
          <div className="inline-flex rounded-full border border-line bg-surface p-0.5 text-sm">
            {(
              [
                ['one_way', 'One way'],
                ['round_trip', 'Round trip'],
              ] as const
            ).map(([id, label]) => (
              <label key={id} className={`cursor-pointer rounded-full px-3 py-1 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary ${tripType === id ? 'bg-primary text-primary-ink' : 'text-muted'}`}>
                <input type="radio" name="tripType" value={id} checked={tripType === id} onChange={() => setTripType(id)} className="sr-only" />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor="s-o" className="label">
            From
          </label>
          <input id="s-o" name="origin" defaultValue={v.origin} maxLength={3} className="field uppercase" required />
        </div>
        <div>
          <label htmlFor="s-d" className="label">
            To {roundTrip ? null : <span className="font-normal text-muted">(empty = anywhere)</span>}
          </label>
          <input
            id="s-d"
            name="destination"
            defaultValue={v.destination}
            maxLength={3}
            placeholder={roundTrip ? 'e.g. CUN' : 'Anywhere'}
            required={roundTrip}
            className="field uppercase placeholder:normal-case"
          />
        </div>
        <div>
          <label htmlFor="s-c" className="label">
            Cabin
          </label>
          <select id="s-c" name="cabin" defaultValue={v.cabin} className="field">
            <option value="all">All cabins</option>
            {CABINS.map((c) => (
              <option key={c} value={c}>
                {CABIN_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="s-n" className="label">
            Seats
          </label>
          <select id="s-n" name="seats" defaultValue={v.seats} className="field">
            {SEAT_CHOICES.map((n) => (
              <option key={n} value={n}>
                {n === 1 ? '1 person' : `${n} people`}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="s-s" className="label">
            {roundTrip ? 'Leave from' : 'From date'}
          </label>
          <input id="s-s" name="startDate" type="date" defaultValue={v.startDate} className="field" required />
        </div>
        <div>
          <label htmlFor="s-e" className="label">
            {roundTrip ? 'Leave by' : 'To date'}
          </label>
          <input id="s-e" name="endDate" type="date" defaultValue={v.endDate} className="field" required />
        </div>
        {roundTrip && (
          <>
            <div className="sm:col-start-5">
              <label htmlFor="s-rs" className="label">
                Return from
              </label>
              <input id="s-rs" name="returnStart" type="date" defaultValue={v.returnStart} className="field" required />
            </div>
            <div>
              <label htmlFor="s-re" className="label">
                Return by
              </label>
              <input id="s-re" name="returnEnd" type="date" defaultValue={v.returnEnd} className="field" required />
            </div>
          </>
        )}
        <div className="sm:col-span-2">
          <label htmlFor="s-a" className="label">
            Airline <span className="font-normal text-muted">(who you fly)</span>
          </label>
          <select id="s-a" name="airline" defaultValue={v.airline} className="field">
            <option value="">Any airline</option>
            {AWARD_AIRLINES.map(([code, name]) => (
              <option key={code} value={code}>
                {name} ({code})
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="s-p" className="label">
            Book with <span className="font-normal text-muted">(points program)</span>
          </label>
          <select id="s-p" name="program" defaultValue={v.program} className="field">
            <option value="">Any Chase partner</option>
            {AWARD_PROGRAMS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="self-end sm:col-span-2">
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? 'Searching…' : 'Search awards'}
          </Button>
        </div>
        {others.length > 0 && (
          <label className="flex items-center gap-2 text-sm sm:col-span-6">
            <input type="checkbox" name="includeHomeAirports" defaultChecked={v.includeHomeAirports} /> Also search from my other home airports ({others.join(', ')})
          </label>
        )}
        <p className="text-xs text-muted sm:col-span-6">
          {roundTrip
            ? 'A round trip searches the way there and the way back (2 of your 1,000 daily seats.aero lookups).'
            : `Leave “To” empty to check ${destinationCount} popular destinations plus your dream destinations at once (about 10 of your 1,000 daily seats.aero lookups).`}{' '}
          With 2 or more people, flights reported to have fewer seats left are hidden.
        </p>
        {(state.error || state.ok) && (
          <p role={state.error ? 'alert' : 'status'} className={`text-sm sm:col-span-6 ${state.error ? 'text-danger' : 'text-ok'}`}>
            {state.error ?? state.ok}
          </p>
        )}
      </form>

      {out && (
        <div className="mt-4 space-y-5">
          {out.roundTrip && <RoundTripSummary picks={out.roundTrips} seats={out.seats} />}
          <Leg title={out.roundTrip ? `Going to ${v.destination}` : null} leg={out} anywhere={out.anywhere} seats={out.seats} canPrice={canPrice} label="Search results" />
          {out.returnLeg && (
            <Leg
              title={`Coming back from ${v.destination}`}
              leg={out.returnLeg}
              anywhere={false}
              seats={out.seats}
              canPrice={canPrice}
              label="Return results"
            />
          )}
          {out.seats > 1 && allRows.length > 0 && <p className="text-xs text-muted">Points are per person — you need {out.seats}× for {out.seats} people.</p>}
          <BonusNotes rows={allRows} />
        </div>
      )}
    </div>
  )
}

function Leg({
  title,
  leg,
  anywhere,
  seats,
  canPrice,
  label,
}: {
  title: string | null
  leg: AwardLegResult
  anywhere: boolean
  seats: number
  canPrice: boolean
  label: string
}) {
  if (!leg.results.length) return title ? <p className="text-sm text-muted">{title}: no open award seats for those dates.</p> : null
  return (
    <section aria-label={label}>
      {title && <h3 className="mb-2 text-sm font-semibold">{title}</h3>}
      {leg.compare ? <CompareTable rows={leg.compare} seats={seats} anywhere={anywhere} label={label} /> : <ResultList rows={leg.results} seats={seats} canPrice={canPrice} label={label} />}
    </section>
  )
}
