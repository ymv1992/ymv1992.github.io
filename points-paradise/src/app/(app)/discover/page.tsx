import type { Metadata } from 'next'
import Link from 'next/link'
import { FEED_MODES, type FeedMode } from '@/lib/domain/constants'
import { SORT_OPTIONS, rankDeals, type SortOption } from '@/lib/engine/ranking'
import { getEvaluation } from '@/lib/server/loaders'
import { buildFeed, overallRanks } from '@/lib/view/feed'
import { toCardData } from '@/lib/view/deal-view'
import { SwipeDeck } from '@/components/deal/swipe-deck'
import { DealList } from '@/components/deal/deal-list'
import { Icon } from '@/components/icons'
import { EmptyState, LinkButton, PageHeader, cx } from '@/components/ui'

export const metadata: Metadata = { title: 'Discover' }

type Search = Promise<{ mode?: string; view?: string; sort?: string }>

export default async function DiscoverPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams
  const mode: FeedMode = FEED_MODES.some((m) => m.id === sp.mode) ? (sp.mode as FeedMode) : 'for-you'
  const view = sp.view === 'list' ? 'list' : 'cards'
  const sort: SortOption = SORT_OPTIONS.some((s) => s.id === sp.sort) ? (sp.sort as SortOption) : 'efficiency'
  const data = await getEvaluation()
  const now = data.ctx.now
  const ranks = overallRanks(data.items, data.account.settings.demoMode, now)
  const programName = (id: string | null) => (id ? (data.partners.get(id)?.programName ?? (id === 'chase_travel' ? 'Chase Travel' : id)) : null)

  const exclude = new Set([...data.dismissedIds, ...(view === 'cards' ? data.savedIds : [])])
  let feed = buildFeed(data.items, mode, { now, exclude })
  if (view === 'list' && sort !== 'efficiency') {
    const ordered = rankDeals(feed, { includeDemo: true }, { now, sort, minConfidence: 'low' }).map((r) => r.item)
    const rest = feed.filter((f) => !ordered.includes(f))
    feed = [...ordered, ...rest]
  }
  const cards = feed.map((e) => toCardData(e, { now, rank: ranks.get(e.deal.id) ?? null, saved: data.savedIds.has(e.deal.id), programName: programName(e.deal.programId) }))
  const hasAnyDeals = data.items.length > 0

  const href = (p: Record<string, string>) => {
    const q = new URLSearchParams({ mode, view, ...(sort !== 'efficiency' ? { sort } : {}), ...p })
    return `/discover?${q.toString()}`
  }

  return (
    <div>
      <PageHeader
        eyebrow="Discover"
        title="Where could your points take you?"
        subtitle="Ranked by points efficiency. Swipe right to save, left to pass — passed deals stay recoverable."
        actions={
          <div className="flex rounded-full border border-line bg-surface p-1" role="group" aria-label="View">
            <Link href={href({ view: 'cards' })} aria-current={view === 'cards' ? 'true' : undefined} className={cx('flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm', view === 'cards' ? 'bg-primary text-primary-ink' : 'text-muted')}>
              <Icon name="cards" className="size-4" /> Cards
            </Link>
            <Link href={href({ view: 'list' })} aria-current={view === 'list' ? 'true' : undefined} className={cx('flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm', view === 'list' ? 'bg-primary text-primary-ink' : 'text-muted')}>
              <Icon name="list" className="size-4" /> List
            </Link>
          </div>
        }
      />

      <nav aria-label="Feed modes" className="-mx-4 mb-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex w-max gap-2">
          {FEED_MODES.map((m) => (
            <li key={m.id}>
              <Link
                href={href({ mode: m.id })}
                aria-current={m.id === mode ? 'page' : undefined}
                className={cx('block rounded-full border px-3.5 py-1.5 text-sm whitespace-nowrap', m.id === mode ? 'border-primary bg-primary-soft font-semibold text-primary' : 'border-line bg-surface text-muted hover:text-ink')}
              >
                {m.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {!hasAnyDeals ? (
        <EmptyState
          title="No deals yet"
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <LinkButton href="/deals/new">Add a deal you found</LinkButton>
              <LinkButton href="/settings#data" variant="secondary">
                Turn on demo data
              </LinkButton>
            </div>
          }
        >
          Points &amp; Paradise only shows real, source-attributed deals. Add one manually, connect a data source in Settings, or explore with clearly labelled demo data.
        </EmptyState>
      ) : view === 'cards' ? (
        <SwipeDeck key={mode} cards={cards} nowMs={now.getTime()} />
      ) : (
        <div>
          <form className="mb-3 flex flex-wrap items-center justify-end gap-2" method="get">
            <input type="hidden" name="mode" value={mode} />
            <input type="hidden" name="view" value="list" />
            <label htmlFor="sort" className="text-sm text-muted">
              Sort by
            </label>
            <select id="sort" name="sort" defaultValue={sort} className="field w-auto">
              {SORT_OPTIONS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <button type="submit" className="rounded-full border border-line bg-surface px-3 py-2 text-sm">
              Apply
            </button>
          </form>
          <DealList items={cards} emptyText="No deals in this view yet." />
          <p className="mt-3 text-xs text-muted">Verified deals are always listed before cached results and unverified leads, whichever sort you pick.</p>
        </div>
      )}
    </div>
  )
}
