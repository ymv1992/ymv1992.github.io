'use client'

import { useActionState, useState } from 'react'
import { createTripAction, updateTripAction } from '@/app/actions/trip-actions'
import type { FormState } from '../action-form'
import { Button } from '../ui'

export interface TripDetailsDefaults {
  tripId?: string
  name: string
  destination: string
  destAirport: string | null
  startDate: string | null
  endDate: string | null
  dayCount: number
  notes: string | null
}

const EMPTY: TripDetailsDefaults = { name: '', destination: '', destAirport: null, startDate: null, endDate: null, dayCount: 3, notes: null }

/** Starts a trip, or edits one when `defaults.tripId` is set. Dates are optional: "someday" trips just get a number of days. */
export function TripDetailsForm({ defaults = EMPTY }: { defaults?: TripDetailsDefaults }) {
  const editing = !!defaults.tripId
  const [state, action, pending] = useActionState<FormState, FormData>(editing ? updateTripAction : createTripAction, { error: null })
  const [hasDates, setHasDates] = useState(!!defaults.startDate || !editing)
  const p = editing ? 'te' : 'tn'

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      {editing && <input type="hidden" name="tripId" value={defaults.tripId} />}
      <div>
        <label htmlFor={`${p}-name`} className="label">
          Trip name
        </label>
        <input id={`${p}-name`} name="name" required maxLength={80} defaultValue={defaults.name} placeholder="Maui anniversary" className="field" />
      </div>
      <div>
        <label htmlFor={`${p}-dest`} className="label">
          Where
        </label>
        <input id={`${p}-dest`} name="destination" maxLength={80} defaultValue={defaults.destination} placeholder="Maui, Hawaii" className="field" />
      </div>
      <fieldset className="sm:col-span-2">
        <legend className="label">When</legend>
        <div className="mb-2 flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="_when" checked={hasDates} onChange={() => setHasDates(true)} /> I know my dates
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="_when" checked={!hasDates} onChange={() => setHasDates(false)} /> Someday (no dates yet)
          </label>
        </div>
        {hasDates ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={`${p}-start`} className="label">
                First day
              </label>
              <input id={`${p}-start`} name="startDate" type="date" defaultValue={defaults.startDate ?? ''} className="field" />
            </div>
            <div>
              <label htmlFor={`${p}-end`} className="label">
                Last day
              </label>
              <input id={`${p}-end`} name="endDate" type="date" defaultValue={defaults.endDate ?? ''} className="field" />
            </div>
          </div>
        ) : (
          <div className="max-w-40">
            <label htmlFor={`${p}-days`} className="label">
              Number of days
            </label>
            <input id={`${p}-days`} name="dayCount" type="number" min={1} max={30} defaultValue={defaults.dayCount} className="field" />
          </div>
        )}
      </fieldset>
      <div>
        <label htmlFor={`${p}-air`} className="label">
          Airport you&rsquo;d fly into <span className="text-faint">(optional)</span>
        </label>
        <input
          id={`${p}-air`}
          name="destAirport"
          maxLength={3}
          defaultValue={defaults.destAirport ?? ''}
          placeholder="OGG"
          autoCapitalize="characters"
          className="field uppercase"
        />
        <p className="mt-1 text-xs text-muted">Needed to watch for award flights to this trip.</p>
      </div>
      <div className="sm:col-span-2">
        <label htmlFor={`${p}-notes`} className="label">
          Notes <span className="text-faint">(optional)</span>
        </label>
        <textarea id={`${p}-notes`} name="notes" rows={2} maxLength={1000} defaultValue={defaults.notes ?? ''} className="field" />
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : editing ? 'Save details' : 'Create trip'}
        </Button>
        {state.error && (
          <span role="alert" className="text-sm text-danger">
            {state.error}
          </span>
        )}
        {state.ok && (
          <span role="status" className="text-sm text-ok">
            {state.ok}
          </span>
        )}
      </div>
    </form>
  )
}
