'use client'

import { useState } from 'react'
import { comparePositioning, type DepartureOption } from '@/lib/engine/positioning'
import { minutesLabel, points, usd } from '@/lib/format'
import { Badge, Card, cx } from '../ui'

export interface PositioningDefaults {
  homeLabel: string
  homeAirport: string
  homePoints: number
  homeCash: number
  homeMinutes: number
  altLabel: string
  altAirport: string
  altPoints: number
  altCash: number
  altMinutes: number
  extraMinutes: number
  international: boolean
}

function NumberField({ id, label, value, onChange, step = 1 }: { id: string; label: string; value: number; onChange: (n: number) => void; step?: number }) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <input id={id} type="number" min={0} step={step} value={Number.isFinite(value) ? value : 0} onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))} className="field tabular" />
    </div>
  )
}

export function PositioningCalculator({ defaults, pointValueCents }: { defaults: PositioningDefaults; pointValueCents: number }) {
  const [d, setD] = useState({
    ...defaults,
    posCash: 0,
    posPoints: 0,
    ground: 0,
    bags: 0,
    hotel: 0,
    meals: 0,
    airportChange: false,
    separateTicket: true,
    overnight: false,
    checkedBags: false,
    valueCents: pointValueCents,
    minutesPer100: 60,
  })
  const set = <K extends keyof typeof d>(k: K) => (v: (typeof d)[K]) => setD((s) => ({ ...s, [k]: v }))
  const home: DepartureOption = { label: d.homeLabel, departureAirport: d.homeAirport, awardChasePoints: d.homePoints, awardCashUsd: d.homeCash, mainTravelMinutes: d.homeMinutes, positioning: null }
  const alt: DepartureOption = {
    label: d.altLabel,
    departureAirport: d.altAirport,
    awardChasePoints: d.altPoints,
    awardCashUsd: d.altCash,
    mainTravelMinutes: d.altMinutes,
    positioning: {
      cashUsd: d.posCash,
      chasePoints: d.posPoints,
      groundUsd: d.ground,
      baggageUsd: d.bags,
      hotelUsd: d.hotel,
      mealsUsd: d.meals,
      extraMinutes: d.extraMinutes,
      airportChange: d.airportChange,
      separateTicket: d.separateTicket,
      overnight: d.overnight,
      international: d.international,
    },
  }
  const c = comparePositioning(home, alt, { pointValueCents: d.valueCents, minutesPer100Usd: d.minutesPer100, checkedBags: d.checkedBags })
  const ready = d.homePoints + d.homeCash > 0 && d.altPoints + d.altCash > 0 && /^[A-Z]{3}$/.test(d.altAirport)

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="font-display text-lg">Option A — depart from home</h2>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label htmlFor="h-air" className="label">
                Airport
              </label>
              <input id="h-air" value={d.homeAirport} onChange={(e) => set('homeAirport')(e.target.value.toUpperCase())} maxLength={3} className="field uppercase" />
            </div>
            <NumberField id="h-pts" label="Award Chase points" value={d.homePoints} onChange={set('homePoints')} step={1000} />
            <NumberField id="h-cash" label="Award taxes & fees (USD)" value={d.homeCash} onChange={set('homeCash')} />
            <NumberField id="h-min" label="Travel time (minutes)" value={d.homeMinutes} onChange={set('homeMinutes')} step={15} />
          </div>
        </Card>
        <Card className="p-4">
          <h2 className="font-display text-lg">Option B — position to another airport</h2>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label htmlFor="a-air" className="label">
                Award departs from
              </label>
              <input id="a-air" value={d.altAirport} onChange={(e) => set('altAirport')(e.target.value.toUpperCase())} maxLength={3} className="field uppercase" />
            </div>
            <NumberField id="a-pts" label="Award Chase points" value={d.altPoints} onChange={set('altPoints')} step={1000} />
            <NumberField id="a-cash" label="Award taxes & fees (USD)" value={d.altCash} onChange={set('altCash')} />
            <NumberField id="a-min" label="Award travel time (minutes)" value={d.altMinutes} onChange={set('altMinutes')} step={15} />
            <NumberField id="p-cash" label="Positioning flight cash (USD)" value={d.posCash} onChange={set('posCash')} />
            <NumberField id="p-pts" label="…or positioning points" value={d.posPoints} onChange={set('posPoints')} step={1000} />
            <NumberField id="p-ground" label="Ground transport (USD)" value={d.ground} onChange={set('ground')} />
            <NumberField id="p-bags" label="Baggage fees (USD)" value={d.bags} onChange={set('bags')} />
            <NumberField id="p-hotel" label="Overnight hotel (USD)" value={d.hotel} onChange={set('hotel')} />
            <NumberField id="p-meals" label="Meals in transit (USD)" value={d.meals} onChange={set('meals')} />
            <NumberField id="p-extra" label="Extra travel time (minutes)" value={d.extraMinutes} onChange={set('extraMinutes')} step={15} />
          </div>
          <div className="mt-3 grid gap-1.5 text-sm">
            {(
              [
                ['separateTicket', 'Positioning flight is a separate ticket'],
                ['overnight', 'Stay overnight before the award flight'],
                ['airportChange', 'Requires changing airports'],
                ['international', 'Positioning crosses a border'],
                ['checkedBags', 'Travelling with checked bags'],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2">
                <input type="checkbox" checked={d[k]} onChange={(e) => set(k)(e.target.checked)} /> {label}
              </label>
            ))}
          </div>
        </Card>
      </div>

      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberField id="v-cents" label="Value per Chase point for comparison (¢)" value={d.valueCents} onChange={set('valueCents')} step={0.05} />
          <NumberField id="v-min" label="Extra minutes you accept per $100 saved" value={d.minutesPer100} onChange={set('minutesPer100')} step={5} />
        </div>
      </Card>

      <section aria-live="polite">
        {!ready ? (
          <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
            Enter the award cost for both options (and the positioning airport) to see a recommendation.
          </p>
        ) : (
          <>
        <div className="grid gap-4 md:grid-cols-2">
          {[c.home, c.alternative].map((o, i) => {
            const winner = (i === 0 && c.recommend === 'home') || (i === 1 && c.recommend === 'alternative')
            return (
              <Card key={o.label} className={cx('p-4', winner && 'border-primary ring-1 ring-primary')}>
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">
                    {i === 0 ? 'A' : 'B'} · {o.departureAirport}
                  </h3>
                  {winner && <Badge tone="ok">Recommended</Badge>}
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-y-1 text-sm">
                  <dt className="text-muted">Chase points</dt>
                  <dd className="tabular text-right">{points(o.chasePoints)}</dd>
                  <dt className="text-muted">Total cash</dt>
                  <dd className="tabular text-right">{usd(o.cashUsd)}</dd>
                  <dt className="text-muted">Travel time</dt>
                  <dd className="tabular text-right">{minutesLabel(o.travelMinutes)}</dd>
                  <dt className="text-muted">Equivalent cost</dt>
                  <dd className="tabular text-right font-semibold">{usd(o.equivalentCostUsd)}</dd>
                </dl>
              </Card>
            )
          })}
        </div>
        <Card className="mt-4 p-4 text-sm">
          <p className="font-semibold">
            {c.recommend === 'alternative' ? `Position to ${c.alternative.departureAirport}` : `Depart from ${c.home.departureAirport}`} — saves {points(Math.max(0, c.pointsSaved))} points, cash difference {usd(c.cashDifferenceUsd)}, {minutesLabel(Math.abs(c.extraMinutes))} {c.extraMinutes >= 0 ? 'longer' : 'shorter'}.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
            {c.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {c.risks.length > 0 && (
            <ul className="mt-3 space-y-1 text-warn">
              {c.risks.map((r) => (
                <li key={r}>⚠ {r}</li>
              ))}
            </ul>
          )}
          {c.recommendedBufferMinutes != null && (
            <p className="mt-3">
              {c.recommendedBufferMinutes === 0 ? 'You plan an overnight before the award flight — the safest separate-ticket plan.' : `Leave at least ${minutesLabel(c.recommendedBufferMinutes)} between flights, or stay overnight.`}
            </p>
          )}
          <p className="mt-3 text-xs text-muted">Airlines are not obliged to protect a missed connection across separately booked tickets. Check passport, visa and transit rules for every country involved.</p>
        </Card>
          </>
        )}
      </section>
    </div>
  )
}
