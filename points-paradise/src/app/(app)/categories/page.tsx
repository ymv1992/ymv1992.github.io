import type { Metadata } from 'next'
import Link from 'next/link'
import { CATEGORY_DEFS } from '@/lib/domain/constants'
import { rankDeals } from '@/lib/engine/ranking'
import { cpp, points } from '@/lib/format'
import { getEvaluation } from '@/lib/server/loaders'
import { Card, PageHeader } from '@/components/ui'

export const metadata: Metadata = { title: 'Categories' }

export default async function CategoriesPage() {
  const data = await getEvaluation()
  const includeDemo = data.account.settings.demoMode
  return (
    <div>
      <PageHeader eyebrow="Rankings" title="Category leaderboards" subtitle="Each leaderboard uses the same efficiency ranking and evidence tiers as the Top 100." />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CATEGORY_DEFS.map((c) => {
          const ranked = rankDeals(data.items, { category: c.slug, includeDemo }, { now: data.ctx.now })
          const top = ranked[0]
          return (
            <li key={c.slug}>
              <Link href={`/categories/${c.slug}`} className="block h-full">
                <Card className="h-full p-4 transition-colors hover:border-primary">
                  <div className="flex items-baseline justify-between">
                    <h2 className="font-display text-xl">{c.label}</h2>
                    <span className="tabular text-sm text-muted">{ranked.length}</span>
                  </div>
                  <p className="text-xs text-muted">{c.description}</p>
                  {top ? (
                    <p className="mt-3 text-sm">
                      <span className="text-faint">Best: </span>
                      {top.item.deal.destination.city} · {points(top.item.valuation.chasePoints)} pts ·{' '}
                      <span className="font-semibold text-primary">{cpp(top.item.valuation.practicalCpp ?? top.item.valuation.headlineCpp)}</span>
                      {top.item.deal.sourceKind === 'demo' && <span className="ml-1 text-xs text-gold">(demo)</span>}
                    </p>
                  ) : (
                    <p className="mt-3 text-sm text-faint">No rankable deals yet</p>
                  )}
                </Card>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
