'use client'

import { useState } from 'react'
import { monthsUntilTopUnder } from '@/lib/engine/portfolio'
import { pct, usd } from '@/lib/format'

/** Months of new contributions until the three largest positions fall under a chosen share. */
export function TopCalculator({ topValue, total, topSymbols, defaultMonthly }: { topValue: number; total: number; topSymbols: string[]; defaultMonthly: number }) {
  const [limit, setLimit] = useState(40)
  const [monthly, setMonthly] = useState(defaultMonthly)
  const [trim, setTrim] = useState(0)
  const months = monthsUntilTopUnder(topValue, total, limit, monthly, trim)
  const now = total > 0 ? (topValue / total) * 100 : 0
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
        <div>
          <label className="label" htmlFor="tc-limit">Bring the top 3 under (%)</label>
          <input id="tc-limit" type="number" min={1} max={100} className="field num" value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
        </div>
        <div>
          <label className="label" htmlFor="tc-monthly">New money each month ($)</label>
          <input id="tc-monthly" type="number" min={0} step={50} className="field num" value={monthly} onChange={(e) => setMonthly(Number(e.target.value))} />
        </div>
        <div>
          <label className="label" htmlFor="tc-trim">One-time trim moved elsewhere ($)</label>
          <input id="tc-trim" type="number" min={0} step={100} className="field num" value={trim} onChange={(e) => setTrim(Number(e.target.value))} />
        </div>
      </div>
      <div className="rounded-xl bg-surface-2 p-5">
        <p className="eyebrow">Top 3 today: {topSymbols.join(', ') || '—'}</p>
        <p className="num mt-1 text-sm text-muted">
          {usd(topValue)} of {usd(total)} = <span className="text-ink">{pct(now)}</span>
        </p>
        <p className="num mt-4 text-4xl text-ink">{months == null ? 'Never' : months === 0 ? 'Already there' : `${months} month${months === 1 ? '' : 's'}`}</p>
        <p className="mt-2 text-sm text-muted">
          {months == null
            ? 'With no new money and no trim, the share does not change on its own.'
            : months === 0
              ? `The top 3 are at or under ${limit}%${trim > 0 ? ' after the trim' : ''}.`
              : `About ${(months / 12).toFixed(1)} years, if every new dollar goes to other holdings.`}
        </p>
        <p className="mt-3 text-xs text-faint">Assumes prices stay where they are. If the top positions keep rising faster than the rest, it takes longer; if they fall, shorter. A trim in a taxable account can create a tax bill.</p>
      </div>
    </div>
  )
}
