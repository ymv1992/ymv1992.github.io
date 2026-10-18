import type { Metadata } from 'next'
import Link from 'next/link'
import { desc, eq, inArray } from 'drizzle-orm'
import { dealPriceHistory, searchHistory } from '@/lib/db/schema'
import { listDismissed } from '@/lib/data/feedback'
import { detectPriceChange, type Observation } from '@/lib/engine/history'
import { formatAge } from '@/lib/engine/status'
import { cpp, dateLabel, dateRange, points, usd } from '@/lib/format'
import { getEvaluationWithArchive } from '@/lib/server/loaders'
import { restoreDismissedAction } from '@/app/actions/deal-actions'
import { watchSimilarAction } from '@/app/actions/alert-actions'
import { Badge, PageHeader, cx } from '@/components/ui'

export const metadata: Metadata = { title: 'History' }

const TABS = [
  { id: 'missed', label: 'Missed & expired' },
  { id: 'passed', label: 'Passed' },
  { id: 'changes', label: 'Price changes' },
  { id: 'searches', label: 'Searches' },
] as const

const REASONS: Record<string, string> = {
  travel_date_passed: 'Travel date passed',
  deadline_passed: 'Booking deadline passed',
  availability_disappeared: 'Award space disappeared',
  archived_by_owner: 'Archived by you',
}

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string }> }) {
  const sp = await searchParams
  const tab = TABS.some((t) => t.id === sp.tab) ? sp.tab! : 'missed'
  const q = sp.q?.trim().toLowerCase().slice(0, 80) ?? ''
  const data = await getEvaluationWithArchive()
  const now = data.ctx.now
  const active = data.items.filter((i) => !i.deal.archivedAt && i.status !== 'expired' && i.status !== 'unavailable')

  return (
    <div>
      <PageHeader eyebrow="History" title="What came and went" subtitle="Historical availability is never shown as current availability. Use it to spot patterns and set up watches." />
      <nav aria-label="History sections" className="mb-6 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/history?tab=${t.id}`}
            aria-current={tab === t.id ? 'page' : undefined}
            className={cx('rounded-full border px-3.5 py-1.5 text-sm', tab === t.id ? 'border-primary bg-primary-soft font-semibold text-primary' : 'border-line bg-surface text-muted')}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === 'missed' && <Missed items={data.items} active={active} q={q} now={now} />}
      {tab === 'passed' && <Passed data={data} />}
      {tab === 'changes' && <Changes data={data} />}
      {tab === 'searches' && <Searches data={data} />}
    </div>
  )
}

type Data = Awaited<ReturnType<typeof getEvaluationWithArchive>>

function Missed({ items, active, q, now }: { items: Data['items']; active: Data['items']; q: string; now: Date }) {
  const archived = items
    .filter((i) => i.deal.archivedAt || i.status === 'expired' || i.status === 'unavailable')
    .filter((i) => !q || `${i.deal.destination.city} ${i.deal.destination.country} ${i.deal.providerName}`.toLowerCase().includes(q))
    .sort((a, b) => (b.deal.archivedAt?.getTime() ?? b.deal.lastSeenAt.getTime()) - (a.deal.archivedAt?.getTime() ?? a.deal.lastSeenAt.getTime()))
  const seenCount = new Map<string, number>()
  for (const i of items) {
    const k = `${i.deal.destination.city}|${i.deal.kind}|${i.deal.programId}`
    seenCount.set(k, (seenCount.get(k) ?? 0) + 1)
  }
  return (
    <div>
      <form className="mb-4 flex gap-2" method="get">
        <input type="hidden" name="tab" value="missed" />
        <label htmlFor="hq" className="sr-only">
          Search the archive
        </label>
        <input id="hq" name="q" defaultValue={q} placeholder="Search destination or provider" className="field max-w-sm" />
        <button type="submit" className="rounded-full border border-line bg-surface px-4 text-sm">
          Search
        </button>
      </form>
      {archived.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">Nothing in the archive{q ? ' matches that search' : ' yet'}.</p>
      ) : (
        <ul className="space-y-3">
          {archived.map((i) => {
            const d = i.deal
            const similar = active.filter((a) => a.deal.destination.city === d.destination.city && a.deal.kind === d.kind && (a.deal.sourceKind === 'demo') === (d.sourceKind === 'demo'))
            const times = seenCount.get(`${d.destination.city}|${d.kind}|${d.programId}`) ?? 1
            return (
              <li key={d.id} className="rounded-2xl border border-line bg-surface p-4">
                <div className="flex flex-wrap items-center gap-1.5">
                  {d.sourceKind === 'demo' && <Badge tone="gold">DEMO · fictional</Badge>}
                  <Badge tone="danger">{REASONS[d.archiveReason ?? ''] ?? (i.status === 'unavailable' ? 'No longer available' : 'Expired')}</Badge>
                  {times > 1 && <Badge tone="primary">Seen {times}× for this destination & program</Badge>}
                  {similar.length > 0 && <Badge tone="ok">Similar deal available now</Badge>}
                </div>
                <Link href={`/deals/${d.id}`} className="mt-1 block font-semibold hover:text-primary">
                  {d.destination.city}, {d.destination.country} <span className="font-normal text-muted">— {d.providerName}</span>
                </Link>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                  <div>
                    <dt className="text-faint">Travel dates</dt>
                    <dd>{dateRange(d.travelStart, d.travelEnd)}</dd>
                  </div>
                  <div>
                    <dt className="text-faint">Seen between</dt>
                    <dd>
                      {dateLabel(d.firstSeenAt.toISOString().slice(0, 10))} – {dateLabel(d.lastSeenAt.toISOString().slice(0, 10))}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-faint">Points then</dt>
                    <dd className="tabular">
                      {points(i.valuation.chasePoints)} + {usd(d.mandatoryCashUsd)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-faint">Observed value</dt>
                    <dd className="tabular">
                      {cpp(i.valuation.practicalCpp ?? i.valuation.headlineCpp)} vs {usd(d.comparableCashUsd)}
                    </dd>
                  </div>
                </dl>
                <div className="mt-3 flex flex-wrap gap-3 text-sm">
                  {similar.slice(0, 2).map((s) => (
                    <Link key={s.deal.id} href={`/deals/${s.deal.id}`} className="text-primary">
                      View similar: {s.deal.providerName} ({dateRange(s.deal.travelStart, s.deal.travelEnd)})
                    </Link>
                  ))}
                  {d.sourceKind !== 'demo' && (
                    <form action={watchSimilarAction.bind(null, d.id)}>
                      <button type="submit" className="text-primary underline-offset-2 hover:underline">
                        Watch for similar
                      </button>
                    </form>
                  )}
                  <span className="text-xs text-faint">Archived {formatAge(d.archivedAt ?? d.lastSeenAt, now)}</span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

async function Passed({ data }: { data: Data }) {
  const rows = await listDismissed(data.db, data.userId)
  const seen = new Set<string>()
  const unique = rows.filter((r) => r.dealId && !seen.has(r.dealId) && seen.add(r.dealId))
  if (unique.length === 0) return <p className="rounded-2xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">You haven&apos;t passed on any deals.</p>
  return (
    <ul className="divide-y divide-line rounded-2xl border border-line bg-surface text-sm">
      {unique.map((r) => {
        const e = data.byId.get(r.dealId!)
        return (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <span>
              {e ? (
                <Link href={`/deals/${e.deal.id}`} className="font-semibold hover:text-primary">
                  {e.deal.destination.city} — {e.deal.providerName}
                </Link>
              ) : (
                'Deal no longer exists'
              )}
              <span className="block text-xs text-faint">Passed {formatAge(r.createdAt, data.ctx.now)}</span>
            </span>
            <form action={restoreDismissedAction.bind(null, r.dealId!)}>
              <button type="submit" className="rounded-full border border-line px-3 py-1.5 text-xs">
                Restore to Discover
              </button>
            </form>
          </li>
        )
      })}
    </ul>
  )
}

async function Changes({ data }: { data: Data }) {
  const since = new Date(data.ctx.now.getTime() - 60 * 86_400_000)
  const ids = data.items.map((i) => i.deal.id)
  const rows = ids.length
    ? await data.db.select().from(dealPriceHistory).where(inArray(dealPriceHistory.dealId, ids)).orderBy(desc(dealPriceHistory.observedAt))
    : []
  const byDeal = new Map<string, typeof rows>()
  for (const r of rows) {
    if (r.observedAt < since) continue
    const list = byDeal.get(r.dealId) ?? []
    list.push(r)
    byDeal.set(r.dealId, list)
  }
  const changes: { dealId: string; at: Date; text: string; good: boolean }[] = []
  for (const [dealId, list] of byDeal) {
    const asc = [...list].reverse()
    for (let i = 1; i < asc.length; i++) {
      const o = (r: (typeof asc)[number]): Observation => ({ observedAt: r.observedAt, programPoints: r.programPoints, cashUsd: r.cashUsd, mandatoryCashUsd: r.mandatoryCashUsd, availability: r.availability as Observation['availability'] })
      const c = detectPriceChange(o(asc[i - 1]!), o(asc[i]!))
      if (c.availabilityChange) changes.push({ dealId, at: asc[i]!.observedAt, text: c.availabilityChange === 'appeared' ? 'Award space appeared' : 'Award space disappeared', good: c.availabilityChange === 'appeared' })
      else if (c.kind !== 'none' && c.pointsPct != null && Math.abs(c.pointsPct) >= 5)
        changes.push({ dealId, at: asc[i]!.observedAt, text: `${c.kind === 'drop' ? 'Dropped' : 'Rose'} ${Math.abs(c.pointsPct)}% to ${points(asc[i]!.programPoints)} pts`, good: c.kind === 'drop' })
    }
  }
  changes.sort((a, b) => b.at.getTime() - a.at.getTime())
  if (changes.length === 0) return <p className="rounded-2xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">No significant price changes in the last 60 days.</p>
  return (
    <ul className="divide-y divide-line rounded-2xl border border-line bg-surface text-sm">
      {changes.slice(0, 100).map((c, i) => {
        const e = data.byId.get(c.dealId)
        return (
          <li key={i} className="flex flex-wrap items-center justify-between gap-2 p-3">
            <Link href={`/deals/${c.dealId}`} className="hover:text-primary">
              {e?.deal.sourceKind === 'demo' && <Badge tone="gold">DEMO</Badge>} {e ? `${e.deal.destination.city} — ${e.deal.providerName}` : c.dealId}
            </Link>
            <span className="flex items-center gap-3">
              <Badge tone={c.good ? 'ok' : 'warn'}>{c.text}</Badge>
              <span className="text-xs text-faint">{formatAge(c.at, data.ctx.now)}</span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}

async function Searches({ data }: { data: Data }) {
  const rows = await data.db
    .select()
    .from(searchHistory)
    .where(eq(searchHistory.userId, data.userId))
    .orderBy(desc(searchHistory.createdAt))
    .limit(100)
  const recent = rows.filter((r) => r.createdAt >= new Date(data.ctx.now.getTime() - 365 * 86_400_000))
  if (recent.length === 0) return <p className="rounded-2xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">No searches recorded yet. Explore searches and deals you add appear here and inform recommendations.</p>
  return (
    <ul className="divide-y divide-line rounded-2xl border border-line bg-surface text-sm">
      {recent.map((r) => (
        <li key={r.id} className="flex justify-between gap-3 p-3">
          <span>
            <Badge>{r.context.replace(/_/g, ' ')}</Badge>{' '}
            {Object.entries(r.query)
              .filter(([, v]) => v != null && v !== '')
              .map(([k, v]) => `${k}: ${String(v)}`)
              .join(' · ')}
          </span>
          <span className="text-xs text-faint">{formatAge(r.createdAt, data.ctx.now)}</span>
        </li>
      ))}
    </ul>
  )
}
