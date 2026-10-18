'use client'

import { useActionState } from 'react'
import { updatePartnerAction, type FormState } from '@/app/actions/transfer-actions'
import { CARD_TYPES } from '@/lib/domain/constants'
import type { PartnerDTO } from '@/lib/view/transfer-dto'
import { Button } from '../ui'

/** Owner correction form — used after checking the current ratio in a Chase account. */
export function PartnerEditor({ partner }: { partner: PartnerDTO }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updatePartnerAction.bind(null, partner.id), { error: null })
  const transferable = CARD_TYPES.filter((c) => c.canTransfer)
  return (
    <form action={action} className="mt-3 grid gap-3 rounded-xl bg-surface-2 p-3 sm:grid-cols-2">
      <fieldset className="sm:col-span-2">
        <legend className="label">Base ratio (Chase : partner)</legend>
        <div className="flex items-center gap-2">
          <input aria-label="Chase side" name="baseChase" type="number" min={1} max={100} defaultValue={partner.baseRatio.chase} className="field w-20" />
          <span>:</span>
          <input aria-label="Partner side" name="basePartner" type="number" min={1} max={100} defaultValue={partner.baseRatio.partner} className="field w-20" />
        </div>
      </fieldset>
      <fieldset className="sm:col-span-2">
        <legend className="label">Card-specific ratios (leave blank to use the base ratio)</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {transferable.map((c) => {
            const o = partner.cardRatioOverrides[c.id]
            return (
              <div key={c.id} className="flex items-center gap-2 text-sm">
                <span className="w-44 shrink-0 text-muted">{c.label}</span>
                <input aria-label={`${c.label} Chase side`} name={`override_${c.id}_chase`} type="number" min={1} max={100} defaultValue={o?.chase} className="field w-16" />
                <span>:</span>
                <input aria-label={`${c.label} partner side`} name={`override_${c.id}_partner`} type="number" min={1} max={100} defaultValue={o?.partner} className="field w-16" />
              </div>
            )
          })}
        </div>
      </fieldset>
      <div>
        <label htmlFor={`min-${partner.id}`} className="label">
          Minimum transfer
        </label>
        <input id={`min-${partner.id}`} name="minTransfer" type="number" min={1} defaultValue={partner.minTransfer} className="field" />
      </div>
      <div>
        <label htmlFor={`inc-${partner.id}`} className="label">
          Transfer increment
        </label>
        <input id={`inc-${partner.id}`} name="transferIncrement" type="number" min={1} defaultValue={partner.transferIncrement} className="field" />
      </div>
      <div>
        <label htmlFor={`proc-${partner.id}`} className="label">
          Processing time
        </label>
        <input id={`proc-${partner.id}`} name="processingTime" defaultValue={partner.processingTime} className="field" />
      </div>
      <div>
        <label htmlFor={`val-${partner.id}`} className="label">
          Your typical value of this currency (¢)
        </label>
        <input id={`val-${partner.id}`} name="typicalValueCents" type="number" step={0.05} min={0} defaultValue={partner.typicalValueCents ?? ''} className="field" />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor={`notes-${partner.id}`} className="label">
          Notes
        </label>
        <textarea id={`notes-${partner.id}`} name="notes" defaultValue={partner.notes ?? ''} className="field" />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={partner.active} /> Active partner
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="markVerified" /> I confirmed these details in my Chase account today
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Saving…' : 'Save partner'}
        </Button>
        {state.error && <span role="alert" className="text-sm text-danger">{state.error}</span>}
        {state.ok && <span role="status" className="text-sm text-ok">{state.ok}</span>}
      </div>
    </form>
  )
}
