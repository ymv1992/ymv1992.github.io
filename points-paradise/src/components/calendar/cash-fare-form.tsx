'use client'

import { useActionState, useId, useState } from 'react'
import { searchCashAction, type CashSearchState } from '@/app/actions/search-actions'
import { CABINS, CABIN_LABELS } from '@/lib/domain/constants'
import { compareEarning, type FlightEarnRates } from '@/lib/domain/earning'
import type { CashItinerary } from '@/lib/providers/serpapi'
import { Badge, Button } from '../ui'

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
const pts = (n: number) => Math.round(n).toLocaleString('en-US')
const hm = (m: number | null) => (m == null ? null : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`)
const times = (r: number) => (Number.isInteger(r) ? `${r}×` : `${r.toFixed(1)}×`)

/** Points earned with the airline vs Chase Travel for one fare, with an optional Chase Travel price to compare. */
function EarnPanel({ price, rates, pointCents }: { price: number; rates: FlightEarnRates; pointCents: number }) {
  const [chase, setChase] = useState('')
  const id = useId()
  const chasePrice = Number(chase.replace(/[$,]/g, ''))
  const typed = chase.trim() !== '' && chasePrice > 0
  const c = compareEarning(price, rates, pointCents, typed ? chasePrice : price)
  const same = rates.direct === rates.chaseTravel
  const better = c.chaseTravelNetUsd < c.directNetUsd - 0.5 ? 'chase' : c.directNetUsd < c.chaseTravelNetUsd - 0.5 ? 'direct' : 'same'
  return (
    <details className="mt-2 rounded-lg bg-surface-2/60 px-3 py-2 text-xs">
      <summary className="cursor-pointer text-primary">
        Chase points you&rsquo;d earn: <strong>{pts(c.directPoints)}</strong> with the airline{!same && <> · <strong>{pts(compareEarning(price, rates, pointCents).chaseTravelPoints)}</strong> through Chase Travel</>}
      </summary>
      <div className="mt-2 space-y-1.5">
        <p>
          With the airline: {pts(c.directPoints)} points ({times(rates.direct)} on {usd(price)}).
        </p>
        <p>
          Through Chase Travel: {pts(c.chaseTravelPoints)} points ({times(rates.chaseTravel)} on {usd(typed ? chasePrice : price)}
          {typed ? '' : ', if Chase shows the same price'}).
        </p>
        {!same && (
          <p>
            Valuing points at {pointCents.toFixed(1)}¢ (your setting), Chase Travel is the better deal up to <strong>{usd(c.breakEvenChasePriceUsd)}</strong>; above that, book with the airline.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <label htmlFor={id} className="text-muted">
            Price you see in Chase Travel
          </label>
          <input id={id} value={chase} onChange={(e) => setChase(e.target.value)} inputMode="decimal" placeholder={usd(price)} className="field h-8 w-28 py-1 text-xs" />
        </div>
        {typed && (
          <p className={better === 'direct' ? 'font-semibold text-warn' : 'font-semibold text-ok'}>
            After points: airline {usd(c.directNetUsd)} vs Chase Travel {usd(c.chaseTravelNetUsd)} —{' '}
            {better === 'direct' ? 'book with the airline.' : better === 'chase' ? 'Chase Travel comes out ahead.' : 'about the same.'}
          </p>
        )}
        <p className="text-muted">Or pay with points through Chase Travel: about {pts(price * 100)} points at 1¢ each (some flights cost fewer with Chase&rsquo;s Points Boost — check there).</p>
      </div>
    </details>
  )
}

function Itinerary({ it, rates, pointCents, perLabel }: { it: CashItinerary; rates: FlightEarnRates; pointCents: number; perLabel: string }) {
  return (
    <li className="rounded-xl border border-line bg-surface p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="text-sm">
          <span className="tabular font-semibold">
            {it.departTime} → {it.arriveTime}
            {it.arriveDayOffset ? <sup className="text-muted"> +{it.arriveDayOffset}</sup> : null}
          </span>{' '}
          <span className="text-muted">· {it.airlines}</span>
          {it.best && (
            <Badge tone="primary" className="ml-2 align-middle">
              Best
            </Badge>
          )}
        </p>
        <p className="tabular text-lg font-semibold">
          {usd(it.priceUsd)} <span className="text-xs font-normal text-muted">{perLabel}</span>
        </p>
      </div>
      <p className="mt-0.5 text-xs text-muted">
        {[hm(it.durationMinutes), it.stops === 0 ? 'Nonstop' : `${it.stops} stop${it.stops > 1 ? 's' : ''}${it.via.length ? ` via ${it.via.join(', ')}` : ''}`, it.overnightLayover ? 'overnight layover' : null, it.flightNumbers.join(', '), it.aircraft]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <EarnPanel price={it.priceUsd} rates={rates} pointCents={pointCents} />
    </li>
  )
}

/** Cash flights from Google Flights, and the Chase points each would earn booked with the airline or through Chase Travel. */
export function CashFareForm({ defaults }: { defaults: { from: string; date: string } }) {
  const [state, action, pending] = useActionState<CashSearchState, FormData>(searchCashAction, { error: null })
  const v = state.values ?? { from: defaults.from, to: '', date: defaults.date, returnDate: '', cabin: 'economy', adults: '1', nonstop: false }
  const out = state.outcome
  const earn = state.earn
  const perLabel = earn ? `${earn.roundTrip ? 'round trip' : 'one way'}${earn.adults > 1 ? `, ${earn.adults} travelers` : ''}` : ''
  return (
    <div>
      <form key={state.attempt ?? 0} action={action} className="grid gap-3 sm:grid-cols-6">
        <div>
          <label htmlFor="c-f" className="label">
            From
          </label>
          <input id="c-f" name="from" defaultValue={v.from} maxLength={3} required className="field uppercase" />
        </div>
        <div>
          <label htmlFor="c-t" className="label">
            To
          </label>
          <input id="c-t" name="to" defaultValue={v.to} maxLength={3} required placeholder="CUN" className="field uppercase" />
        </div>
        <div>
          <label htmlFor="c-d" className="label">
            Depart
          </label>
          <input id="c-d" name="date" type="date" defaultValue={v.date} required className="field" />
        </div>
        <div>
          <label htmlFor="c-r" className="label">
            Return <span className="font-normal text-muted">(optional)</span>
          </label>
          <input id="c-r" name="returnDate" type="date" defaultValue={v.returnDate} className="field" />
        </div>
        <div>
          <label htmlFor="c-c" className="label">
            Cabin
          </label>
          <select id="c-c" name="cabin" defaultValue={v.cabin} className="field">
            {CABINS.map((c) => (
              <option key={c} value={c}>
                {CABIN_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="c-a" className="label">
            Travelers
          </label>
          <select id="c-a" name="adults" defaultValue={v.adults} className="field">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm sm:col-span-3">
          <input type="checkbox" name="nonstop" defaultChecked={v.nonstop} /> Nonstop only
        </label>
        <div className="sm:col-span-3 sm:justify-self-end">
          <Button type="submit" disabled={pending} className="w-full sm:w-auto">
            {pending ? 'Searching…' : 'Search cash fares'}
          </Button>
        </div>
        <p className="text-xs text-muted sm:col-span-6">Prices come from Google Flights and use 1 of your monthly Google searches. Each fare shows the Chase points it would earn with the airline or through Chase Travel.</p>
        {state.error && (
          <p role="alert" className="text-sm text-danger sm:col-span-6">
            {state.error}
          </p>
        )}
      </form>

      {out && earn && (
        <div className="mt-4 space-y-3">
          {out.insights?.level && (
            <p role="status" className="text-sm">
              Google says prices for this trip are <strong>{out.insights.level}</strong> right now
              {out.insights.typicalLowUsd != null && out.insights.typicalHighUsd != null ? ` (usually ${usd(out.insights.typicalLowUsd)}–${usd(out.insights.typicalHighUsd)})` : ''}.
            </p>
          )}
          <p className="text-xs text-muted">
            Your card: {earn.cardLabel} — {earn.rates.note}.{' '}
            {earn.rates.confirmed ? 'Rates as Chase publishes them; confirm in your Chase account.' : 'Choose your card in Settings for exact rates.'}
          </p>
          <ul className="space-y-2" aria-label="Cash fares">
            {out.itineraries.slice(0, 15).map((it, i) => (
              <Itinerary key={`${it.flightNumbers.join('-')}-${i}`} it={it} rates={earn.rates} pointCents={earn.pointCents} perLabel={perLabel} />
            ))}
          </ul>
          <p className="text-xs text-muted">
            {earn.roundTrip ? 'Round-trip prices include the way back; pick the return on Google Flights. ' : ''}Booking with the airline usually makes changes and delays easier to sort out. Either way, the airline&rsquo;s own miles
            usually still count.
          </p>
          {out.googleFlightsUrl && (
            <a href={out.googleFlightsUrl} target="_blank" rel="noopener noreferrer" className="inline-block text-sm text-primary hover:underline">
              Open this search in Google Flights ↗
            </a>
          )}
        </div>
      )}
    </div>
  )
}
