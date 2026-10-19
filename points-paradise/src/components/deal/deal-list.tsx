import Link from 'next/link'
import type { DealCardData } from '@/lib/view/deal-view'
import { cpp, points, usd } from '@/lib/format'
import { Badge, StatusBadge } from '../ui'
import { DealImage } from './deal-card'
import { SaveToggle } from './save-toggle'

/** Compact, scannable list of deals with the same facts as the swipe cards. */
export function DealList({ items, showRank = false, emptyText = 'No deals match.' }: { items: (DealCardData & { rankLabel?: string; explanation?: string[] })[]; showRank?: boolean; emptyText?: string }) {
  if (items.length === 0) return <p className="rounded-2xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">{emptyText}</p>
  return (
    <ol className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
      {items.map((d) => (
        <li key={d.id} className="flex gap-3 p-3 sm:gap-4 sm:p-4">
          {showRank && (
            <div className="tabular w-8 shrink-0 pt-1 text-center font-display text-xl text-gold" aria-label={d.rankLabel ?? `Rank ${d.rank}`}>
              {d.rank ?? '–'}
            </div>
          )}
          <div className="relative hidden size-20 shrink-0 overflow-hidden rounded-xl sm:block">
            <DealImage d={d} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {d.isDemo ? <Badge tone="gold">DEMO · fictional</Badge> : <StatusBadge status={d.status} />}
              {d.bonusLabel && <Badge tone="gold">{d.bonusLabel}</Badge>}
              {d.warnings.map((w) => (
                <Badge key={w} tone="warn">
                  ⚠ {w}
                </Badge>
              ))}
            </div>
            <Link href={`/deals/${d.id}`} className="mt-1 block font-semibold text-ink hover:text-primary">
              {d.city}, {d.country}
              <span className="font-normal text-muted"> — {d.provider}</span>
            </Link>
            <p className="truncate text-xs text-muted">
              {d.productLine} · {d.dates}
            </p>
            {d.explanation && d.explanation.length > 0 && (
              <details className="mt-1 text-xs text-muted">
                <summary className="cursor-pointer text-primary">Why this rank?</summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {d.explanation.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1 text-right">
            <div className="tabular text-lg font-semibold text-primary">{d.cpp != null ? cpp(d.cpp) : <span className="text-xs text-warn">Not calculable</span>}</div>
            <div className="tabular text-xs text-ink">{points(d.chasePoints)} pts</div>
            <div className="tabular text-xs text-muted">+ {usd(d.mandatoryCashUsd)}</div>
            <SaveToggle dealId={d.id} saved={d.saved} compact />
          </div>
        </li>
      ))}
    </ol>
  )
}
