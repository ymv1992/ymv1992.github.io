import { BUCKET_LABELS } from '@/lib/domain/types'
import type { AllocationRow } from '@/lib/engine/portfolio'
import { pct, usd } from '@/lib/format'

/**
 * Current share per bucket as a bar, with the target as a tick mark on the
 * same 0–100% scale. Values are written beside every bar, so the chart reads
 * without relying on color.
 */
export function AllocationBars({ rows, compact = false }: { rows: AllocationRow[]; compact?: boolean }) {
  const max = Math.max(50, ...rows.map((r) => Math.max(r.pct, r.targetPct)))
  const scale = (v: number) => `${Math.min(100, (v / max) * 100)}%`
  return (
    <div>
      <ul className={compact ? 'space-y-3' : 'space-y-4'}>
        {rows.map((r) => (
          <li key={r.bucket}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-ink">{BUCKET_LABELS[r.bucket]}</span>
              <span className="num text-xs text-muted">
                <span className="text-sm text-ink">{pct(r.pct)}</span> / target {pct(r.targetPct, 0)}
                {!compact && <span className="ml-2 hidden sm:inline">{usd(r.value)}</span>}
              </span>
            </div>
            <div className="relative mt-1.5 h-2.5 rounded-full bg-surface-2" role="img" aria-label={`${BUCKET_LABELS[r.bucket]}: ${pct(r.pct)} of portfolio, target ${pct(r.targetPct, 0)}`}>
              <div className="h-full rounded-full bg-gold" style={{ width: scale(r.pct), minWidth: r.pct > 0 ? 4 : 0 }} />
              <div className="absolute -top-1 h-[18px] w-0.5 rounded bg-ink" style={{ left: `calc(${scale(r.targetPct)} - 1px)` }} title={`Target ${pct(r.targetPct, 0)}`} />
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-4 flex items-center gap-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-5 rounded-full bg-gold" /> Current
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3.5 w-0.5 rounded bg-ink" /> Your target
        </span>
      </p>
    </div>
  )
}
