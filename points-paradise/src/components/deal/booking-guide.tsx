'use client'

import { useEffect, useState } from 'react'
import type { ChecklistStep } from '@/lib/engine/booking'
import { Icon } from '../icons'
import { cx } from '../ui'

/** Checklist for booking independently. Progress is remembered on this device only. */
export function BookingGuide({ dealId, steps }: { dealId: string; steps: ChecklistStep[] }) {
  const key = `pp-checklist-${dealId}`
  const [done, setDone] = useState<Set<string>>(new Set())
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring per-device progress after hydration
      if (raw) setDone(new Set(JSON.parse(raw) as string[]))
    } catch {
      // Storage unavailable: the checklist still works for this visit.
    }
  }, [key])
  function toggle(id: string) {
    const next = new Set(done)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setDone(next)
    try {
      localStorage.setItem(key, JSON.stringify([...next]))
    } catch {
      // ignore
    }
  }
  return (
    <ol className="space-y-2">
      {steps.map((s, i) => {
        const checked = done.has(s.id)
        return (
          <li key={s.id} className={cx('rounded-xl border p-3', checked ? 'border-ok/30 bg-ok-soft/40' : s.warning ? 'border-warn/40 bg-warn-soft/40' : 'border-line bg-surface')}>
            <label className="flex cursor-pointer gap-3">
              <input type="checkbox" className="mt-1 size-4 shrink-0 accent-[var(--primary)]" checked={checked} onChange={() => toggle(s.id)} />
              <span className="min-w-0">
                <span className={cx('block text-sm font-semibold', checked && 'text-muted line-through')}>
                  {i + 1}. {s.title}
                </span>
                <span className="block text-sm text-muted">{s.detail}</span>
              </span>
            </label>
            {s.link && (
              <a href={s.link.url} target="_blank" rel="noopener noreferrer nofollow" className="mt-2 ml-7 inline-flex items-center gap-1 text-sm text-primary underline-offset-2 hover:underline">
                {s.link.label} <Icon name="external" className="size-3.5" />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            )}
          </li>
        )
      })}
    </ol>
  )
}
