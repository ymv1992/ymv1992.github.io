'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { archiveSavedAction, setSavedCollectionsAction, unsaveDealAction, updateSavedAction } from '@/app/actions/deal-actions'
import type { DealCardData } from '@/lib/view/deal-view'
import { cpp, points, usd } from '@/lib/format'
import { DealImage } from '../deal/deal-card'
import { Countdown } from '../deal/countdown'
import { Badge, Button, StatusBadge, cx } from '../ui'

export interface SavedItemData {
  savedId: string
  card: DealCardData
  savedAtLabel: string
  original: { programPoints: number | null; chasePoints: number | null; cashUsd: number | null; cpp: number | null }
  notes: string | null
  collectionIds: string[]
  alertPriceDrop: boolean
  alertAvailability: boolean
  alertDeadline: boolean
  archived: boolean
  booked: boolean
  watchLabel: string | null
}

function Delta({ before, after, invert = false, format }: { before: number | null; after: number | null; invert?: boolean; format: (n: number) => string }) {
  if (before == null || after == null || Math.abs(after - before) < 1e-9) return null
  const better = invert ? after < before : after > before
  return (
    <span className={cx('text-xs font-semibold', better ? 'text-ok' : 'text-danger')}>
      {after > before ? '▲' : '▼'} {format(Math.abs(after - before))}
    </span>
  )
}

export function SavedItem({ item, collections, nowMs, compareSelected, onToggleCompare }: { item: SavedItemData; collections: { id: string; name: string }[]; nowMs: number; compareSelected: boolean; onToggleCompare: () => void }) {
  const [pending, start] = useTransition()
  const [notes, setNotes] = useState(item.notes ?? '')
  const [cols, setCols] = useState(item.collectionIds)
  const [msg, setMsg] = useState<string | null>(null)
  const d = item.card

  function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    start(async () => {
      const res = await fn().catch(() => ({ ok: false, message: 'Network problem — not saved.' }))
      setMsg(res.message ?? null)
    })
  }

  return (
    <li className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <div className="flex gap-4">
        <div className="relative hidden size-24 shrink-0 overflow-hidden rounded-xl sm:block">
          <DealImage d={d} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {d.isDemo ? <Badge tone="gold">DEMO · fictional</Badge> : <StatusBadge status={d.status} />}
            {item.booked && <Badge tone="ok">Booked</Badge>}
            {item.watchLabel && <Badge tone="primary">{item.watchLabel}</Badge>}
            {d.warnings.map((w) => (
              <Badge key={w} tone="warn">
                ⚠ {w}
              </Badge>
            ))}
          </div>
          <Link href={`/deals/${d.id}`} className="mt-1 block font-semibold hover:text-primary">
            {d.city}, {d.country} <span className="font-normal text-muted">— {d.provider}</span>
          </Link>
          <p className="text-xs text-muted">
            {d.productLine} · {d.dates} · saved {item.savedAtLabel} · last verified {d.lastVerified}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <div className="text-[11px] text-faint uppercase">Chase pts now</div>
              <div className="tabular font-semibold">
                {points(d.chasePoints)} <Delta before={item.original.chasePoints} after={d.chasePoints} invert format={points} />
              </div>
              <div className="text-[11px] text-faint">saved at {points(item.original.chasePoints)}</div>
            </div>
            <div>
              <div className="text-[11px] text-faint uppercase">Cash now</div>
              <div className="tabular font-semibold">
                {usd(d.mandatoryCashUsd)} <Delta before={item.original.cashUsd} after={d.mandatoryCashUsd} invert format={(n) => usd(n)} />
              </div>
              <div className="text-[11px] text-faint">saved at {usd(item.original.cashUsd)}</div>
            </div>
            <div>
              <div className="text-[11px] text-faint uppercase">Value now</div>
              <div className="tabular font-semibold text-primary">
                {cpp(d.cpp)} <Delta before={item.original.cpp} after={d.cpp} format={(n) => `${n.toFixed(2)}¢`} />
              </div>
              <div className="text-[11px] text-faint">saved at {cpp(item.original.cpp)}</div>
            </div>
            <div>
              <div className="text-[11px] text-faint uppercase">Deadline</div>
              <div className="text-sm font-semibold">{d.deadlineAtIso ? <Countdown targetIso={d.deadlineAtIso} nowMs={nowMs} /> : d.deadlineHeadline}</div>
            </div>
          </div>
        </div>
      </div>

      <details className="mt-3">
        <summary className="cursor-pointer text-sm text-primary">Notes, collections &amp; alerts</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`notes-${item.savedId}`} className="label">
              Notes
            </label>
            <textarea id={`notes-${item.savedId}`} className="field min-h-24" maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
            <Button size="sm" variant="secondary" className="mt-2" disabled={pending} onClick={() => run(() => updateSavedAction(item.savedId, { notes: notes || null }))}>
              Save notes
            </Button>
          </div>
          <div>
            <fieldset>
              <legend className="label">Collections</legend>
              <div className="flex flex-wrap gap-1.5">
                {collections.map((c) => {
                  const on = cols.includes(c.id)
                  return (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={on}
                      disabled={pending}
                      onClick={() => {
                        const next = on ? cols.filter((x) => x !== c.id) : [...cols, c.id]
                        setCols(next)
                        run(() => setSavedCollectionsAction(item.savedId, next))
                      }}
                      className={cx('rounded-full border px-2.5 py-1 text-xs', on ? 'border-primary bg-primary-soft text-primary' : 'border-line text-muted')}
                    >
                      {c.name}
                    </button>
                  )
                })}
              </div>
            </fieldset>
            <fieldset className="mt-4 space-y-1 text-sm">
              <legend className="label">Alert me about</legend>
              {(
                [
                  ['alertPriceDrop', 'Price drops', item.alertPriceDrop],
                  ['alertAvailability', 'Availability changes', item.alertAvailability],
                  ['alertDeadline', 'Booking deadline reminders', item.alertDeadline],
                ] as const
              ).map(([key, label, value]) => (
                <label key={key} className="flex items-center gap-2">
                  <input type="checkbox" defaultChecked={value} disabled={pending} onChange={(e) => run(() => updateSavedAction(item.savedId, { [key]: e.target.checked }))} />
                  {label}
                </label>
              ))}
              <label className="flex items-center gap-2">
                <input type="checkbox" defaultChecked={item.booked} disabled={pending} onChange={(e) => run(() => updateSavedAction(item.savedId, { booked: e.target.checked }))} />
                I booked this
              </label>
            </fieldset>
          </div>
        </div>
      </details>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <label className="mr-auto flex items-center gap-2 text-sm">
          <input type="checkbox" checked={compareSelected} onChange={onToggleCompare} />
          Compare
        </label>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => archiveSavedAction(item.savedId, !item.archived))}>
          {item.archived ? 'Restore' : 'Archive'}
        </Button>
        <Button size="sm" variant="ghost" className="text-danger" disabled={pending} onClick={() => run(() => unsaveDealAction(d.id))}>
          Remove
        </Button>
      </div>
      {msg && (
        <p role="status" className="mt-2 text-xs text-muted">
          {msg}
        </p>
      )}
    </li>
  )
}
