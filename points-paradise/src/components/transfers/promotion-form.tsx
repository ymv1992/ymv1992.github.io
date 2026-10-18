'use client'

import { useActionState } from 'react'
import { createPromotionAction, type FormState } from '@/app/actions/transfer-actions'
import { CARD_TYPES } from '@/lib/domain/constants'
import { Button } from '../ui'

export function PromotionForm({ partners }: { partners: { id: string; label: string }[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createPromotionAction, { error: null })
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div>
        <label htmlFor="promo-partner" className="label">
          Partner
        </label>
        <select id="promo-partner" name="partnerId" className="field" required>
          {partners.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="promo-bonus" className="label">
          Bonus %
        </label>
        <input id="promo-bonus" name="bonusPercent" type="number" min={1} max={300} required className="field" placeholder="e.g. 30" />
      </div>
      <div>
        <label htmlFor="promo-tz" className="label">
          Deadline time zone
        </label>
        <input id="promo-tz" name="endsAtTimezone" defaultValue="America/New_York" className="field" />
      </div>
      <div>
        <label htmlFor="promo-start" className="label">
          Starts
        </label>
        <input id="promo-start" name="startsAt" type="datetime-local" required className="field" />
      </div>
      <div>
        <label htmlFor="promo-end" className="label">
          Ends
        </label>
        <input id="promo-end" name="endsAt" type="datetime-local" className="field" />
      </div>
      <div>
        <label htmlFor="promo-source" className="label">
          Source link
        </label>
        <input id="promo-source" name="sourceUrl" type="url" placeholder="https://…" className="field" />
      </div>
      <fieldset className="sm:col-span-2 lg:col-span-3">
        <legend className="label">Eligible cards (none selected = all transfer-capable cards)</legend>
        <div className="flex flex-wrap gap-3 text-sm">
          {CARD_TYPES.filter((c) => c.canTransfer).map((c) => (
            <label key={c.id} className="flex items-center gap-1.5">
              <input type="checkbox" name="eligibleCardTypes" value={c.id} /> {c.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="sm:col-span-2 lg:col-span-3">
        <label htmlFor="promo-elig" className="label">
          Eligibility notes
        </label>
        <input id="promo-elig" name="eligibility" className="field" placeholder="e.g. Targeted, registration required" />
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm sm:col-span-2 lg:col-span-3">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="isTargeted" /> Targeted (not everyone gets it)
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="verifiedOnChase" /> I saw this offer in my Chase account
        </label>
        <input type="hidden" name="sourceKind" value="announcement" />
      </div>
      <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Add promotion'}
        </Button>
        {state.error && <span role="alert" className="text-sm text-danger">{state.error}</span>}
        {state.ok && <span role="status" className="text-sm text-ok">{state.ok}</span>}
      </div>
      <p className="text-xs text-muted sm:col-span-2 lg:col-span-3">Start and end times are read in the deadline time zone above (promotions usually end at 11:59 PM Eastern). Targeted offers are never applied automatically.</p>
    </form>
  )
}
