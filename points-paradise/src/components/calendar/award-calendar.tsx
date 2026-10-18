'use client'

import Link from 'next/link'
import { useState } from 'react'

export interface CalendarCell {
  date: string
  points: number | null
  dealId: string | null
  status: 'available' | 'unavailable' | 'none'
  isDemo: boolean
  cash: number | null
}

const SEQ = ['var(--seq-1)', 'var(--seq-2)', 'var(--seq-3)', 'var(--seq-4)', 'var(--seq-5)']
// Steps 4–5 are dark in light mode and light in dark mode; pick ink accordingly.
const INK = ['var(--ink)', 'var(--ink)', 'var(--ink)', 'var(--surface)', 'var(--surface)']

const compact = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}K` : String(n))

/**
 * Month grids of the lowest points price observed per travel date. Fewer
 * points = deeper color. Hover or focus a day for details; the table under
 * the calendar lists every value.
 */
export function AwardCalendar({ cells, months, label }: { cells: CalendarCell[]; months: string[]; label: string }) {
  const [active, setActive] = useState<CalendarCell | null>(null)
  const priced = cells.filter((c) => c.points != null).map((c) => c.points!)
  const lo = priced.length ? Math.min(...priced) : 0
  const hi = priced.length ? Math.max(...priced) : 1
  const bucket = (p: number) => (hi === lo ? 4 : Math.min(4, Math.floor(((hi - p) / (hi - lo)) * 4.999)))
  const byDate = new Map(cells.map((c) => [c.date, c]))

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-muted" aria-hidden>
        <span>More points</span>
        <span className="flex">
          {SEQ.map((c) => (
            <span key={c} className="h-3 w-6" style={{ background: c }} />
          ))}
        </span>
        <span>Fewer points</span>
        <span className="ml-3 flex items-center gap-1">
          <span className="h-3 w-6 rounded-sm border border-dashed border-line" /> No space found
        </span>
      </div>
      <div className="relative grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {months.map((m) => {
          const first = new Date(`${m}-01T00:00:00Z`)
          const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
          const offset = first.getUTCDay()
          const title = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first)
          return (
            <div key={m}>
              <p className="mb-1 text-sm font-semibold">{title}</p>
              <div className="grid grid-cols-7 gap-0.5 text-center text-[10px]" role="grid" aria-label={`${title}: ${label}`}>
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                  <div key={i} className="pb-1 text-faint" aria-hidden>
                    {d}
                  </div>
                ))}
                {Array.from({ length: offset }, (_, i) => (
                  <div key={`pad-${i}`} aria-hidden />
                ))}
                {Array.from({ length: days }, (_, i) => {
                  const date = `${m}-${String(i + 1).padStart(2, '0')}`
                  const c = byDate.get(date)
                  const b = c?.points != null ? bucket(c.points) : null
                  const text = c?.points != null ? compact(c.points) : ''
                  const aria = c ? (c.points != null ? `${date}: ${c.points.toLocaleString('en-US')} points${c.isDemo ? ' (demo)' : ''}` : `${date}: no award space found`) : `${date}: no data`
                  const inner = (
                    <>
                      <span className="block leading-none opacity-70">{i + 1}</span>
                      <span className="block leading-tight font-semibold">{text}</span>
                    </>
                  )
                  const style = b != null ? { background: SEQ[b], color: INK[b] } : undefined
                  const cls = `flex h-10 flex-col items-center justify-center rounded-md ${c?.status === 'unavailable' ? 'border border-dashed border-line text-faint' : c ? '' : 'bg-surface-2/40 text-faint'}`
                  return c?.dealId ? (
                    <Link
                      key={date}
                      href={`/deals/${c.dealId}`}
                      className={`${cls} hover:outline-2 hover:outline-primary`}
                      style={style}
                      aria-label={aria}
                      onMouseEnter={() => setActive(c)}
                      onMouseLeave={() => setActive(null)}
                      onFocus={() => setActive(c)}
                      onBlur={() => setActive(null)}
                    >
                      {inner}
                    </Link>
                  ) : (
                    <div key={date} className={cls} style={style} aria-label={aria} role="gridcell">
                      {inner}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
        {active && (
          <div role="status" className="pointer-events-none absolute -top-2 right-0 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-card">
            <div className="text-sm font-semibold">{active.points != null ? `${active.points.toLocaleString('en-US')} pts` : 'No space found'}</div>
            <div className="text-muted">
              {active.date}
              {active.cash != null && ` · + $${Math.round(active.cash)}`}
              {active.isDemo && ' · demo'}
            </div>
          </div>
        )}
      </div>
      <details className="mt-4 text-sm">
        <summary className="cursor-pointer text-primary">Show as table</summary>
        <table className="mt-2 w-full text-left text-xs">
          <thead className="text-faint">
            <tr>
              <th className="py-1 font-medium">Date</th>
              <th className="py-1 font-medium">Points</th>
              <th className="py-1 font-medium">Cash</th>
              <th className="py-1 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {cells
              .slice()
              .sort((a, b) => a.date.localeCompare(b.date))
              .map((c) => (
                <tr key={c.date} className="border-t border-line">
                  <td className="py-1">{c.date}</td>
                  <td className="py-1">{c.points != null ? c.points.toLocaleString('en-US') : '—'}</td>
                  <td className="py-1">{c.cash != null ? `$${Math.round(c.cash)}` : '—'}</td>
                  <td className="py-1">
                    {c.status === 'available' ? 'Available at last check' : 'No space found'}
                    {c.isDemo ? ' (demo)' : ''}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
      {priced.length === 0 && <p className="mt-2 text-sm text-muted">No priced dates yet for this selection.</p>}
    </div>
  )
}
