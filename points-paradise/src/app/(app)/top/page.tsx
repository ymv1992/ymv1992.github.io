import type { Metadata } from 'next'
import Link from 'next/link'
import { rankDeals } from '@/lib/engine/ranking'
import { priceImprovements } from '@/lib/data/deals'
import { getEvaluation } from '@/lib/server/loaders'
import { parseFilters, type SearchParams } from '@/lib/view/filters'
import { FilterForm } from '@/components/ranking/filter-form'
import { RankedList } from '@/components/ranking/ranked-list'
import { PageHeader } from '@/components/ui'

export const metadata: Metadata = { title: 'Top 100' }

export default async function TopPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const data = await getEvaluation()
  const includeDemo = data.account.settings.demoMode
  const { filters, sort, raw, active } = parseFilters(sp, {
    includeDemo,
    savedIds: data.savedIds,
    homeAirports: data.account.profile.homeAirports,
  })
  const improvements = sort === 'price_improvement' ? await priceImprovements(data.db) : undefined
  const ranked = rankDeals(data.items, filters, { now: data.ctx.now, sort, limit: 100, priceImprovement: improvements })
  const programName = (id: string | null) => (id ? (data.partners.get(id)?.programName ?? (id === 'chase_travel' ? 'Chase Travel' : id)) : null)

  return (
    <div>
      <PageHeader
        eyebrow="Rankings"
        title="Top 100 Chase redemptions"
        subtitle="Ranked by practical cents per point within evidence tiers. Verified deals always come first; expired, unavailable and predicted deals are never ranked."
        actions={
          <Link href="/categories" className="rounded-full border border-line bg-surface px-4 py-2 text-sm">
            Category leaderboards
          </Link>
        }
      />
      <FilterForm action="/top" raw={raw} active={active} includeDemo={includeDemo} />
      <RankedList
        ranked={ranked}
        all={data.items}
        now={data.ctx.now}
        savedIds={data.savedIds}
        programName={programName}
        includeDemo={includeDemo}
        emptyText={active > 0 ? 'No deals match these filters.' : 'No rankable deals yet. Add a deal with a points price, taxes and a comparable cash price, or turn on demo data.'}
      />
      <details className="mt-8 text-sm text-muted">
        <summary className="cursor-pointer font-semibold text-ink">How ranking works</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Value = ((comparable cash price − mandatory cash) ÷ Chase points) × 100, using the realistic &ldquo;practical&rdquo; price when it is lower.</li>
          <li>Deals are grouped by evidence: verified within 3 days, cached, then unverified leads. A lead can never outrank a verified deal.</li>
          <li>Deals with low-confidence cash comparisons or missing taxes are listed under &ldquo;Can&apos;t be ranked yet&rdquo;.</li>
          <li>Personal match never changes the value order; use &ldquo;Best personal match&rdquo; sorting or the For You feed for that.</li>
        </ul>
      </details>
    </div>
  )
}
