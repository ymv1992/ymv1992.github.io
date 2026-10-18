'use client'

import { useActionState } from 'react'
import { searchAwardsAction, type SearchState } from '@/app/actions/search-actions'
import { CABINS, CABIN_LABELS } from '@/lib/domain/constants'
import { Button } from '../ui'

export function AwardSearchForm({ defaults }: { defaults: { origin: string; destination: string; cabin: string; startDate: string; endDate: string } }) {
  const [state, action, pending] = useActionState<SearchState, FormData>(searchAwardsAction, { error: null })
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-6">
      <div>
        <label htmlFor="s-o" className="label">
          From
        </label>
        <input id="s-o" name="origin" defaultValue={defaults.origin} maxLength={3} className="field uppercase" required />
      </div>
      <div>
        <label htmlFor="s-d" className="label">
          To
        </label>
        <input id="s-d" name="destination" defaultValue={defaults.destination} maxLength={3} className="field uppercase" required />
      </div>
      <div>
        <label htmlFor="s-c" className="label">
          Cabin
        </label>
        <select id="s-c" name="cabin" defaultValue={defaults.cabin} className="field">
          {CABINS.map((c) => (
            <option key={c} value={c}>
              {CABIN_LABELS[c]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="s-s" className="label">
          From date
        </label>
        <input id="s-s" name="startDate" type="date" defaultValue={defaults.startDate} className="field" required />
      </div>
      <div>
        <label htmlFor="s-e" className="label">
          To date
        </label>
        <input id="s-e" name="endDate" type="date" defaultValue={defaults.endDate} className="field" required />
      </div>
      <div className="self-end">
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? 'Searching…' : 'Search awards'}
        </Button>
      </div>
      {(state.error || state.ok) && (
        <p role={state.error ? 'alert' : 'status'} className={`sm:col-span-6 text-sm ${state.error ? 'text-danger' : 'text-ok'}`}>
          {state.error ?? state.ok}
        </p>
      )}
    </form>
  )
}
