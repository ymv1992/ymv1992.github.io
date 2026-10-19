import type { Metadata } from 'next'
import { listCollections, listSaved } from '@/lib/data/saved'
import { listWatches } from '@/lib/data/watchlists'
import { formatAge } from '@/lib/engine/status'
import { getEvaluationWithArchive } from '@/lib/server/loaders'
import { toCardData } from '@/lib/view/deal-view'
import { overallRanks } from '@/lib/view/feed'
import { SavedBoard } from '@/components/saved/saved-board'
import type { SavedItemData } from '@/components/saved/saved-item'
import { PageHeader } from '@/components/ui'

export const metadata: Metadata = { title: 'Saved' }

export default async function SavedPage({ searchParams }: { searchParams: Promise<{ collection?: string; archived?: string }> }) {
  const sp = await searchParams
  const archived = sp.archived === '1'
  const data = await getEvaluationWithArchive()
  const now = data.ctx.now
  const [saved, collections, watches] = await Promise.all([
    listSaved(data.db, data.userId, { archived }),
    listCollections(data.db, data.userId),
    listWatches(data.db, data.userId),
  ])
  const allSaved = archived ? await listSaved(data.db, data.userId) : saved
  const ranks = overallRanks(data.items.filter((i) => !i.deal.archivedAt), data.account.settings.demoMode, now)
  const watchByDeal = new Map(watches.filter((w) => w.dealId && w.active).map((w) => [w.dealId!, w]))
  const items: SavedItemData[] = saved
    .map((s) => {
      const e = data.byId.get(s.dealId)
      if (!e) return null
      const w = watchByDeal.get(s.dealId)
      return {
        savedId: s.id,
        card: toCardData(e, { now, rank: ranks.get(s.dealId) ?? null, saved: true, programName: null }),
        savedAtLabel: formatAge(s.savedAt, now),
        original: { programPoints: s.originalProgramPoints, chasePoints: s.originalChasePoints, cashUsd: s.originalCashUsd, cpp: s.originalCpp },
        notes: s.notes,
        collectionIds: s.collectionIds,
        alertPriceDrop: s.alertPriceDrop,
        alertAvailability: s.alertAvailability,
        alertDeadline: s.alertDeadline,
        archived: !!s.archivedAt,
        booked: !!s.bookedAt,
        watchLabel: w ? (w.autoCheckSupported ? 'Watching · auto-checks' : 'Watching · manual checks') : null,
      }
    })
    .filter((x): x is SavedItemData => x !== null)
  const counts = new Map<string, number>()
  for (const s of allSaved) for (const c of s.collectionIds) counts.set(c, (counts.get(c) ?? 0) + 1)
  const active = sp.collection && collections.some((c) => c.id === sp.collection) ? sp.collection : null

  return (
    <div>
      <PageHeader eyebrow="Saved" title="Your saved deals" subtitle="Original prices are kept so you can see what changed since you saved. Collections, notes and alerts live here." />
      <SavedBoard
        items={items}
        collections={collections.map((c) => ({ id: c.id, name: c.name, count: counts.get(c.id) ?? 0, isDefault: c.isDefault }))}
        active={active}
        archived={archived}
        nowMs={now.getTime()}
      />
    </div>
  )
}
