import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CATEGORY_DEFS, type CategorySlug } from '@/lib/domain/constants'
import { rankDeals } from '@/lib/engine/ranking'
import { priceImprovements } from '@/lib/data/deals'
import { getEvaluation } from '@/lib/server/loaders'
import { parseFilters, type SearchParams } from '@/lib/view/filters'
import { FilterForm } from '@/components/ranking/filter-form'
import { RankedList } from '@/components/ranking/ranked-list'
import { PageHeader } from '@/components/ui'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  return { title: CATEGORY_DEFS.find((c) => c.slug === slug)?.label ?? 'Category' }
}

export default async function CategoryPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SearchParams> }) {
  const { slug } = await params
  const def = CATEGORY_DEFS.find((c) => c.slug === slug)
  if (!def) notFound()
  const sp = await searchParams
  const data = await getEvaluation()
  const includeDemo = data.account.settings.demoMode
  const { filters, sort, raw, active } = parseFilters(sp, {
    includeDemo,
    category: def.slug as CategorySlug,
    savedIds: data.savedIds,
    homeAirports: data.account.profile.homeAirports,
  })
  const improvements = sort === 'price_improvement' ? await priceImprovements(data.db) : undefined
  const ranked = rankDeals(data.items, filters, { now: data.ctx.now, sort, limit: 100, priceImprovement: improvements })
  const programName = (id: string | null) => (id ? (data.partners.get(id)?.programName ?? (id === 'chase_travel' ? 'Chase Travel' : id)) : null)
  const inCategory = data.items.filter((i) => i.categories.includes(def.slug as CategorySlug))
  return (
    <div>
      <PageHeader
        eyebrow="Category"
        title={def.label}
        subtitle={def.description}
        actions={
          <Link href="/categories" className="rounded-full border border-line bg-surface px-4 py-2 text-sm">
            All categories
          </Link>
        }
      />
      <FilterForm action={`/categories/${def.slug}`} raw={raw} active={active} includeDemo={includeDemo} />
      <RankedList
        ranked={ranked}
        all={inCategory}
        now={data.ctx.now}
        savedIds={data.savedIds}
        programName={programName}
        includeDemo={includeDemo}
        emptyText="No rankable deals in this category yet."
      />
    </div>
  )
}
