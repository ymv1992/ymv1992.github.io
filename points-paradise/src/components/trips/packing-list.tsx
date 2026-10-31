'use client'

import { useActionState, useState, useTransition } from 'react'
import { addPackingItemAction, removePackingItemAction, setPackedAction, suggestPackingAction } from '@/app/actions/trip-actions'
import type { FormState } from '@/components/action-form'
import { PACKING_CATEGORY_LABEL, PACKING_ORDER } from '@/lib/trips/packing'
import type { PackingCategory } from '@/lib/db/schema'
import { Icon } from '../icons'
import { Button } from '../ui'

export interface PackingView {
  id: string
  label: string
  category: PackingCategory
  reason: string | null
  packed: boolean
}

/** The trip's packing list: suggestions from its dates, weather and plans, plus your own items. */
export function PackingList({ tripId, items }: { tripId: string; items: PackingView[] }) {
  const [packed, setPackedState] = useState<Record<string, boolean>>(() => Object.fromEntries(items.map((i) => [i.id, i.packed])))
  const [removed, setRemoved] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const [state, add, adding] = useActionState<FormState, FormData>(addPackingItemAction, { error: null })
  const list = items.filter((i) => !removed.has(i.id))
  const done = list.filter((i) => packed[i.id]).length

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">{list.length ? `${done} of ${list.length} packed` : 'Nothing on the list yet.'}</p>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              try {
                setMessage((await suggestPackingAction(tripId)).message)
              } catch {
                setMessage('Could not reach the site. Try again.')
              }
            })
          }
        >
          {pending ? 'Thinking…' : list.length ? 'Suggest more' : 'Suggest a packing list'}
        </Button>
      </div>
      {message && (
        <p role="status" className="mt-2 text-xs text-ok">
          {message}
        </p>
      )}
      {PACKING_ORDER.map((cat) => {
        const group = list.filter((i) => i.category === cat)
        if (!group.length) return null
        return (
          <section key={cat} className="mt-3">
            <h3 className="text-xs font-semibold tracking-wide text-faint uppercase">{PACKING_CATEGORY_LABEL[cat]}</h3>
            <ul className="mt-1 space-y-1">
              {group.map((i) => (
                <li key={i.id} className="group flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!!packed[i.id]}
                    onChange={(e) => {
                      const v = e.target.checked
                      setPackedState((p) => ({ ...p, [i.id]: v }))
                      start(async () => {
                        try {
                          await setPackedAction(tripId, i.id, v)
                        } catch {
                          setPackedState((p) => ({ ...p, [i.id]: !v }))
                        }
                      })
                    }}
                    aria-label={`Packed: ${i.label}`}
                    className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className={packed[i.id] ? 'text-muted line-through' : ''}>{i.label}</span>
                    {i.reason && <span className="block text-xs text-faint">{i.reason}</span>}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setRemoved((r) => new Set(r).add(i.id))
                      start(async () => {
                        try {
                          await removePackingItemAction(tripId, i.id)
                        } catch {
                          setRemoved((r) => {
                            const n = new Set(r)
                            n.delete(i.id)
                            return n
                          })
                        }
                      })
                    }}
                    aria-label={`Remove ${i.label}`}
                    className="rounded p-0.5 text-faint hover:bg-danger-soft hover:text-danger"
                  >
                    <Icon name="x" className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
      <form key={state.ok ? `ok-${list.length}` : 'form'} action={add} className="mt-4 flex gap-2">
        <input type="hidden" name="tripId" value={tripId} />
        <label htmlFor={`pack-${tripId}`} className="sr-only">
          Add something to pack
        </label>
        <input id={`pack-${tripId}`} name="label" maxLength={80} placeholder="Add your own, e.g. Snorkel mask" className="field min-w-0 flex-1" required />
        <Button type="submit" size="sm" disabled={adding}>
          Add
        </Button>
      </form>
      {state.error && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {state.error}
        </p>
      )}
    </div>
  )
}
