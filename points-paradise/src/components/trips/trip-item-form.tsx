'use client'

import { useActionState } from 'react'
import { saveTripItemAction, type TripItemFormState } from '@/app/actions/trip-actions'
import { TRIP_ITEM_KINDS, dayHeading, type TripDayView, type TripItemView } from '@/lib/trips/shared'
import { Button } from '../ui'

/**
 * Adds a thing to do, or edits one (`item` given). Choosing another day here
 * moves it, for anyone who would rather not drag.
 */
export function TripItemForm({
  tripId,
  days,
  item,
  day,
  onCancel,
}: {
  tripId: string
  days: TripDayView[]
  item?: TripItemView
  /** Preselected day for a new item; null = ideas. */
  day?: number | null
  onCancel: () => void
}) {
  const [state, action, pending] = useActionState<TripItemFormState, FormData>(saveTripItemAction, { error: null })
  const p = `ti-${item?.id ?? `new-${day ?? 'ideas'}`}`
  const dayValue = item ? (item.day ?? 'ideas') : (day ?? 'ideas')

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
        <input id={`${p}-place`} name="place" maxLength={200} defaultValue={item?.place ?? ''} placeholder="Ma'alaea Harbor" className="field" />
      </div>
      <div className="sm:col-span-3">
        <label htmlFor={`${p}-url`} className="label">
          Link <span className="text-faint">(optional)</span>
        </label>
        <input id={`${p}-url`} name="url" type="url" maxLength={500} defaultValue={item?.url ?? ''} placeholder="https://" className="field" />
      </div>
      <div className="sm:col-span-3">
        <label htmlFor={`${p}-cost`} className="label">
          Cost in $ <span className="text-faint">(optional)</span>
        </label>
        <input id={`${p}-cost`} name="costUsd" type="number" min={0} step="0.01" defaultValue={item?.costUsd ?? ''} className="field tabular" />
      </div>
      <div className="sm:col-span-3">
        <label htmlFor={`${p}-pts`} className="label">
          Chase points <span className="text-faint">(optional)</span>
        </label>
        <input id={`${p}-pts`} name="points" type="number" min={0} step={1} defaultValue={item?.points ?? ''} className="field tabular" />
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
