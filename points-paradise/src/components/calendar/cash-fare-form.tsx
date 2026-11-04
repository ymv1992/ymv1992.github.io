'use client'

import { useActionState, useId, useRef, useState } from 'react'
import { searchCashAction, type CashSearchState } from '@/app/actions/search-actions'
import { CABINS, CABIN_LABELS } from '@/lib/domain/constants'
import { compareEarning, type FlightEarnRates } from '@/lib/domain/earning'
import type { CashItinerary, ExploreDestination } from '@/lib/providers/serpapi'
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

const shortDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

/** One "Anywhere" result: the cheapest fare Google shows to a place, with the points it would earn. */
function Destination({ d, rates, pointCents, roundTrip, onShow }: { d: ExploreDestination; rates: FlightEarnRates; pointCents: number; roundTrip: boolean; onShow: (() => void) | null }) {
  return (
    <li className="rounded-xl border border-line bg-surface p-3">
      <div className="flex gap-3">
        {d.thumbnail && (
          // eslint-disable-next-line @next/next/no-img-element -- Google's destination thumbnail; next/image would need the host allow-listed for no gain.
          <img src={d.thumbnail} alt="" loading="lazy" className="size-16 shrink-0 rounded-lg object-cover" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <p className="font-semibold">
              {d.city}
              {d.country ? <span className="font-normal text-muted">, {d.country}</span> : null}
              {d.airport ? <span className="text-xs font-normal text-muted"> · {d.airport}</span> : null}
            </p>
            <p className="tabular text-lg font-semibold">
              {usd(d.priceUsd)} <span className="text-xs font-normal text-muted">{roundTrip ? 'round trip' : 'one way'}</span>
            </p>
          </div>
          <p className="text-xs text-muted">
            {[
              d.startDate ? `${shortDay(d.startDate)}${d.endDate ? ` – ${shortDay(d.endDate)}` : ''}` : null,
              d.airline,
              d.stops === 0 ? 'Nonstop' : d.stops != null ? `${d.stops} stop${d.stops > 1 ? 's' : ''}` : null,
              d.duration,
              d.hotelPriceUsd != null ? `hotels from ${usd(d.hotelPriceUsd)}/night` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs">
            {onShow && (
              <button type="button" onClick={onShow} className="rounded-full border border-line px-2.5 py-1 text-primary hover:bg-surface-2">
                Show flights
              </button>
            )}
            {d.link && (
              <a href={d.link} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                Open in Google ↗
              </a>
            )}
          </div>
          <EarnPanel price={d.priceUsd} rates={rates} pointCents={pointCents} />
        </div>
      </div>
    </li>
  )
}

/** Cash flights from Google Flights, and the Chase points each would earn booked with the airline or through Chase Travel. */
export function CashFareForm({ defaults }: { defaults: { from: string; date: string } }) {
  const [state, action, pending] = useActionState<CashSearchState, FormData>(searchCashAction, { error: null })
  const v = state.values ?? { from: defaults.from, to: '', date: defaults.date, returnDate: '', cabin: 'economy', adults: '1', nonstop: false }
  const [backToList, setBackToList] = useState<number | null>(null)
  // Showing the kept "Anywhere" list again, until the next search.
  const listing = backToList === (state.attempt ?? 0) && state.lastAnywhere
  const out = listing ? { ok: true as const, mode: 'anywhere' as const, destinations: state.lastAnywhere!.destinations } : state.outcome
  const form = useRef<HTMLFormElement>(null)
  // "Show flights" on an Anywhere result: fill in that airport and search it.
  const showFlights = (airport: string) => {
    const f = form.current
    if (!f) return
    ;(f.elements.namedItem('to') as HTMLInputElement).value = airport
    f.requestSubmit()
  }
  const earn = state.earn
  const perLabel = earn ? `${earn.roundTrip ? 'round trip' : 'one way'}${earn.adults > 1 ? `, ${earn.adults} travelers` : ''}` : ''
  return (
    <div>
      <form ref={form} key={state.attempt ?? 0} action={action} className="grid gap-3 sm:grid-cols-6">
        <div>
          <label htmlFor="c-f" className="label">
            From
          </label>
          <input id="c-f" name="from" defaultValue={v.from} maxLength={3} required className="field uppercase" />
        </div>
        <div>
          <label htmlFor="c-t" className="label">
            To <span className="font-normal text-muted">(empty = anywhere)</span>
          </label>
          <input id="c-t" name="to" defaultValue={v.to} maxLength={3} placeholder="Anywhere" className="field uppercase placeholder:normal-case" />
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
        <p className="text-xs text-muted sm:col-span-6">
          Prices come from Google Flights and use 1 of your monthly Google searches. Leave &ldquo;To&rdquo; empty to see the cheapest places to go from your airport on those dates (Google&rsquo;s Explore view, economy, per
          person). Each fare shows the Chase points it would earn with the airline or through Chase Travel.
        </p>
        {state.error && (
          <p role="alert" className="text-sm text-danger sm:col-span-6">
            {state.error}
          </p>
        )}
      </form>

      {out?.mode === 'anywhere' && earn && (
        <div className="mt-4 space-y-3">
          <p role="status" className="text-sm">
            The cheapest places to go from {v.from}
            {v.returnDate ? ' and back' : ''}, according to Google, per person in economy. Tap <strong>Show flights</strong> to see the exact flights (1 more search).
          </p>
          <p className="text-xs text-muted">
            Your card: {earn.cardLabel} — {earn.rates.note}.
          </p>
          <ul className="space-y-2" aria-label="Cheapest destinations">
            {out.destinations.slice(0, 40).map((d, i) => (
              <Destination key={`${d.city}-${i}`} d={d} rates={earn.rates} pointCents={earn.pointCents} roundTrip={earn.roundTrip} onShow={d.airport ? () => showFlights(d.airport!) : null} />
            ))}
          </ul>
        </div>
      )}

      {out?.mode === 'route' && earn && (
        <div className="mt-4 space-y-3">
          {state.lastAnywhere && (
            <button type="button" onClick={() => setBackToList(state.attempt ?? 0)} className="text-sm text-primary hover:underline">
              ← Back to all destinations from {state.lastAnywhere.from}
            </button>
          )}
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
