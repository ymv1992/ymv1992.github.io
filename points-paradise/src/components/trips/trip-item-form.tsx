'use client'

import { useActionState, useState } from 'react'
import { saveTripItemAction, type TripItemFormState } from '@/app/actions/trip-actions'
import { CURRENCIES, currencyName } from '@/lib/trips/money'
import { TRIP_ITEM_KINDS, dayHeading, type TripDayView, type TripItemView } from '@/lib/trips/shared'
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
        <select id={`${p}-kind`} name="kind" defaultValue={item?.kind ?? 'activity'} className="field">
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
          Time <span className="text-faint">(optional)</span>
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
