import type { EvaluatedDeal } from '@/lib/engine/evaluate'
import { TIER_LABELS, unrankable, type RankedDeal } from '@/lib/engine/ranking'
import { toCardData } from '@/lib/view/deal-view'
import Link from 'next/link'
import { DealList } from '../deal/deal-list'
import { Badge, SectionTitle } from '../ui'

interface Props {
  ranked: RankedDeal[]
  all: EvaluatedDeal[]
  now: Date
  savedIds: Set<string>
  programName: (id: string | null) => string | null
  includeDemo: boolean
  emptyText: string
}

/** Leaderboard grouped by evidence tier, plus deals that cannot be ranked yet and why. */
export function RankedList({ ranked, all, now, savedIds, programName, includeDemo, emptyText }: Props) {
  const tiers = [...new Set(ranked.map((r) => r.tier))].sort()
  const needsInfo = unrankable(all, includeDemo).slice(0, 20)
  return (
    <div className="space-y-8">
      {ranked.length === 0 && <p className="rounded-2xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">{emptyText}</p>}
      {tiers.map((tier) => {
        const rows = ranked.filter((r) => r.tier === tier)
        return (
          <section key={tier} aria-labelledby={`tier-${tier}`}>
            <SectionTitle aside={<Badge tone={tier === 0 ? 'ok' : tier === 3 ? 'gold' : 'warn'}>{rows.length}</Badge>}>
              <span id={`tier-${tier}`}>{TIER_LABELS[tier]}</span>
            </SectionTitle>
            {tier !== 0 && (
              <p className="mb-3 text-sm text-muted">
                {tier === 3
                  ? 'Fictional sample data, shown so you can explore the app. Never bookable.'
                  : 'Ranked separately and never presented as bookable — verify on the official site before transferring points.'}
              </p>
            )}
            <DealList
              showRank
              items={rows.map((r) => ({
                ...toCardData(r.item, { now, rank: r.rank, saved: savedIds.has(r.item.deal.id), programName: programName(r.item.deal.programId) }),
                explanation: r.explanation,
              }))}
            />
          </section>
        )
      })}
      {needsInfo.length > 0 && (
        <section aria-labelledby="needs-info">
          <SectionTitle>
            <span id="needs-info">Can&apos;t be ranked yet</span>
          </SectionTitle>
          <ul className="divide-y divide-line rounded-2xl border border-line bg-surface text-sm">
            {needsInfo.map(({ item, reason }) => (
              <li key={item.deal.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <Link href={`/deals/${item.deal.id}`} className="font-medium hover:text-primary">
                  {item.deal.destination.city} — {item.deal.providerName}
                </Link>
                <span className="text-warn">{reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
