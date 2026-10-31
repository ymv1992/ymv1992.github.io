'use client'

import { useActionState, useState } from 'react'
import { saveTripItemAction, type TripItemFormState } from '@/app/actions/trip-actions'
import { CURRENCIES, currencyName } from '@/lib/trips/money'
import { TRIP_ITEM_KINDS, dayHeading, type TripDayView, type TripItemKind, type TripItemView } from '@/lib/trips/shared'
import { Button } from '../ui'

/**
 * Adds a thing to do, or edits one (`item` given). Choosing another day here
 * moves it, for anyone who would rather not drag.
 */
export function TripItemForm({
  tripId,
  days,
  currency,
  item,
  day,
  onCancel,
}: {
  tripId: string
  days: TripDayView[]
  /** The trip's local currency, preselected for a new cost. */
  currency: string | null
  item?: TripItemView
  /** Preselected day for a new item; null = ideas. */
  day?: number | null
  onCancel: () => void
}) {
  const [state, action, pending] = useActionState<TripItemFormState, FormData>(saveTripItemAction, { error: null })
  const p = `ti-${item?.id ?? `new-${day ?? 'ideas'}`}`
  const dayValue = item ? (item.day ?? 'ideas') : (day ?? 'ideas')
  const costCurrency = item?.costAmount != null ? item.costCurrency : (currency ?? 'USD')
  const [usedPoints, setUsedPoints] = useState(!!item?.points)
  const [kind, setKind] = useState<TripItemKind>(item?.kind ?? 'activity')
  const b = item?.booking ?? {}
  // The trip's currency and dollars first, then everything else.
  const firstCodes = [...new Set([currency, 'USD'].filter((c): c is string => !!c))]

  return (
    <form action={action} className="grid gap-3 rounded-xl border border-line bg-surface-2/60 p-3 sm:grid-cols-6">
      <input type="hidden" name="tripId" value={tripId} />
      {item && <input type="hidden" name="itemId" value={item.id} />}
      <div className="sm:col-span-4">
        <label htmlFor={`${p}-title`} className="label">
          What
        </label>
        <input id={`${p}-title`} name="title" required maxLength={120} defaultValue={item?.title} placeholder="Snorkel at Molokini" className="field" autoFocus />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor={`${p}-kind`} className="label">
          Type
        </label>
        <select id={`${p}-kind`} name="kind" value={kind} onChange={(e) => setKind(e.target.value as TripItemKind)} className="field">
          {TRIP_ITEM_KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-3">
        <label htmlFor={`${p}-day`} className="label">
          Day
        </label>
        <select id={`${p}-day`} name="day" defaultValue={String(dayValue)} className="field">
          <option value="ideas">Ideas (no day yet)</option>
          {days.map((d) => (
            <option key={d.day} value={d.day}>
              {dayHeading(d)}
            </option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-3">
        <label htmlFor={`${p}-time`} className="label">
          {kind === 'flight' ? 'Departs' : kind === 'hotel' ? 'Check-in time' : 'Time'} <span className="text-faint">(optional)</span>
        </label>
        <input id={`${p}-time`} name="time" type="time" defaultValue={item?.time ?? ''} className="field" />
      </div>
      <div className="sm:col-span-3">
        <label htmlFor={`${p}-place`} className="label">
          Place or address <span className="text-faint">(optional)</span>
        </label>
        <input id={`${p}-place`} name="place" maxLength={200} defaultValue={item?.place ?? ''} placeholder="Molokini Crater, or a Google Maps link" className="field" />
      </div>
      <div className="sm:col-span-3">
        <label htmlFor={`${p}-url`} className="label">
          Link <span className="text-faint">(optional)</span>
        </label>
        <input id={`${p}-url`} name="url" type="url" maxLength={500} defaultValue={item?.url ?? ''} placeholder="https://" className="field" />
        <p className="mt-1 text-xs text-muted">Paste a Google Maps link (or fill in the place) and a map and photo are added.</p>
      </div>
      <div className="sm:col-span-3">
        <label htmlFor={`${p}-cost`} className="label">
          Cost <span className="text-faint">(optional)</span>
        </label>
        <div className="flex gap-2">
          <input
            id={`${p}-cost`}
            name="costAmount"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            defaultValue={item?.costAmount ?? ''}
            placeholder="0"
            className="field tabular min-w-0 flex-1"
          />
          <label htmlFor={`${p}-cur`} className="sr-only">
            Currency
          </label>
          <select id={`${p}-cur`} name="costCurrency" defaultValue={costCurrency} className="field w-28 shrink-0">
            {firstCodes.map((c) => (
              <option key={c} value={c}>
                {c} · {currencyName(c)}
              </option>
            ))}
            <optgroup label="Other currencies">
              {CURRENCIES.filter(([c]) => !firstCodes.includes(c)).map(([c, n]) => (
                <option key={c} value={c}>
                  {c} · {n}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
        <p className="mt-1 text-xs text-muted">Enter it in the local currency; it&rsquo;s shown in dollars too.</p>
      </div>
      <div className="sm:col-span-3">
        <label className="flex items-center gap-2 text-sm sm:mt-6">
          <input type="checkbox" checked={usedPoints} onChange={(e) => setUsedPoints(e.target.checked)} /> I booked this with points
        </label>
        {/* Only sent while ticked, so unticking clears the points on save. */}
        {usedPoints && (
          <div className="mt-2">
            <label htmlFor={`${p}-pts`} className="label">
              Points used
            </label>
            <input
              id={`${p}-pts`}
              name="points"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              defaultValue={item?.points ?? ''}
              placeholder="e.g. 60000"
              className="field tabular"
              autoFocus={!item?.points}
            />
            <p className="mt-1 text-xs text-muted">Put any taxes and fees you paid in Cost.</p>
          </div>
        )}
      </div>
      {kind !== 'note' && (
        <details open={!!item?.booking && Object.keys(item.booking).some((k) => k !== 'schedule')} className="rounded-lg border border-line bg-surface px-3 py-2 sm:col-span-6">
          <summary className="cursor-pointer text-sm font-semibold">
            Booking details <span className="font-normal text-faint">(optional)</span>
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-6">
            <div className="sm:col-span-2">
              <label htmlFor={`${p}-conf`} className="label">
                Confirmation number
              </label>
              <input id={`${p}-conf`} name="b_confirmation" maxLength={40} defaultValue={b.confirmation ?? ''} placeholder="e.g. K7Q2PZ" className="field uppercase placeholder:normal-case" />
            </div>
            {kind === 'flight' && (
              <>
                <div className="sm:col-span-2">
                  <label htmlFor={`${p}-fn`} className="label">
                    Flight number
                  </label>
                  <input id={`${p}-fn`} name="b_flightNumber" maxLength={10} defaultValue={b.flightNumber ?? ''} placeholder="e.g. UA 1234" className="field uppercase placeholder:normal-case" />
                </div>
                <div>
                  <label htmlFor={`${p}-from`} className="label">
                    From
                  </label>
                  <input id={`${p}-from`} name="b_from" maxLength={3} defaultValue={b.from ?? ''} placeholder="LAX" className="field uppercase" />
                </div>
                <div>
                  <label htmlFor={`${p}-to`} className="label">
                    To
                  </label>
                  <input id={`${p}-to`} name="b_to" maxLength={3} defaultValue={b.to ?? ''} placeholder="CUN" className="field uppercase" />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor={`${p}-arr`} className="label">
                    Arrives <span className="text-faint">(local time)</span>
                  </label>
                  <div className="flex gap-2">
                    <input id={`${p}-arr`} name="b_arriveTime" type="time" defaultValue={b.arriveTime ?? ''} className="field min-w-0 flex-1" />
                    <label htmlFor={`${p}-arrd`} className="sr-only">
                      Arrival day
                    </label>
                    <select id={`${p}-arrd`} name="b_arriveDayOffset" defaultValue={String(b.arriveDayOffset ?? 0)} className="field w-32 shrink-0">
                      <option value="0">Same day</option>
                      <option value="1">Next day</option>
                      <option value="2">2 days later</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label htmlFor={`${p}-seat`} className="label">
                    Seat
                  </label>
                  <input id={`${p}-seat`} name="b_seat" maxLength={10} defaultValue={b.seat ?? ''} placeholder="14A" className="field uppercase" />
                </div>
                <div className="sm:col-span-3">
                  <label htmlFor={`${p}-ac`} className="label">
                    Aircraft
                  </label>
                  <input id={`${p}-ac`} name="b_aircraft" maxLength={80} defaultValue={b.aircraft ?? ''} placeholder="Leave empty to look it up" className="field" />
                </div>
                <p className="text-xs text-muted sm:col-span-6">
                  After saving, tap <strong>Find times &amp; aircraft</strong> on the flight to fill these in from Google Flights (uses 1 of your monthly Google searches).
                </p>
              </>
            )}
            {kind === 'hotel' && (
              <>
                <div>
                  <label htmlFor={`${p}-nights`} className="label">
                    Nights
                  </label>
                  <input id={`${p}-nights`} name="b_nights" type="number" inputMode="numeric" min={1} max={60} defaultValue={b.nights ?? ''} placeholder="3" className="field tabular" />
                </div>
                <div>
                  <label htmlFor={`${p}-co`} className="label">
                    Check-out time
                  </label>
                  <input id={`${p}-co`} name="b_checkOutTime" type="time" defaultValue={b.checkOutTime ?? ''} className="field" />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor={`${p}-phone`} className="label">
                    Hotel phone
                  </label>
                  <input id={`${p}-phone`} name="b_phone" type="tel" maxLength={40} defaultValue={b.phone ?? ''} className="field" />
                </div>
                <p className="text-xs text-muted sm:col-span-6">Put the stay on the day you check in; the check-in time goes in &ldquo;Check-in time&rdquo; above.</p>
              </>
            )}
          </div>
        </details>
      )}
      <div className="sm:col-span-6">
        <label htmlFor={`${p}-notes`} className="label">
          Notes <span className="text-faint">(optional)</span>
        </label>
        <textarea id={`${p}-notes`} name="notes" rows={2} maxLength={1000} defaultValue={item?.notes ?? ''} className="field" />
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-6">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Saving…' : item ? 'Save' : 'Add'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {state.error && (
          <span role="alert" className="text-sm text-danger">
            {state.error}
          </span>
        )}
      </div>
    </form>
  )
}
