import type { Metadata } from 'next'
import { and, eq, gte } from 'drizzle-orm'
import { searchHistory } from '@/lib/db/schema'
import { REGIONS, REGION_LABELS, TAG_LABELS, TRAVEL_TAGS, type Region, type TravelTag } from '@/lib/domain/constants'
import { evidenceTier } from '@/lib/engine/ranking'
import { cpp, points } from '@/lib/format'
import { integrationStatus } from '@/lib/server/config'
import { getEvaluation } from '@/lib/server/loaders'
import { toCardData } from '@/lib/view/deal-view'
import { overallRanks } from '@/lib/view/feed'
import { PLAYBOOK, PLAYBOOK_REVIEWED } from '@/lib/view/playbook'
import { DealList } from '@/components/deal/deal-list'
import { Ideas } from '@/components/explore/ideas'
import { WorldMap, type MapPoint } from '@/components/explore/world-map'
import { Badge, Card, LinkButton, PageHeader, SectionTitle } from '@/components/ui'

export const metadata: Metadata = { title: 'Explore' }

type SP = Promise<{ q?: string; region?: string; tag?: string; maxPoints?: string; destination?: string }>

export default async function ExplorePage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams
  const data = await getEvaluation()
  const now = data.ctx.now
  const q = sp.q?.trim().slice(0, 80) ?? ''
  const region = REGIONS.includes(sp.region as Region) ? (sp.region as Region) : null
  const tag = TRAVEL_TAGS.includes(sp.tag as TravelTag) ? (sp.tag as TravelTag) : null
  const maxPoints = sp.maxPoints && Number(sp.maxPoints) > 0 ? Number(sp.maxPoints) : null
  const destination = sp.destination?.trim().slice(0, 80) ?? null

  // Record searches (deduplicated) so they can inform recommendations and appear in History.
  if (q || destination) {
    const recent = await data.db
      .select({ id: searchHistory.id })
      .from(searchHistory)
      .where(and(eq(searchHistory.userId, data.userId), eq(searchHistory.context, 'explore'), gte(searchHistory.createdAt, new Date(now.getTime() - 10 * 60_000))))
    if (recent.length === 0) await data.db.insert(searchHistory).values({ userId: data.userId, context: 'explore', query: { q, destination, region, tag, maxPoints } })
  }

  const live = data.items.filter((i) => evidenceTier(i.status) != null && !data.dismissedIds.has(i.deal.id))
  const filtered = live.filter((i) => {
    const d = i.deal
    if (q && !`${d.destination.city} ${d.destination.country} ${d.providerName} ${d.title}`.toLowerCase().includes(q.toLowerCase())) return false
    if (region && d.destination.region !== region) return false
    if (tag && !d.tags.includes(tag)) return false
    if (maxPoints != null && (i.valuation.chasePoints == null || i.valuation.chasePoints > maxPoints)) return false
    if (destination && d.destination.city !== destination) return false
    return true
  })

  const groups = new Map<string, MapPoint & { region: Region; lowestPoints: number | null; tags: Set<string> }>()
  for (const i of filtered) {
    const d = i.deal
    const key = `${d.destination.city}|${d.destination.country}`
    const value = i.valuation.practicalCpp ?? i.valuation.headlineCpp
    const g = groups.get(key) ?? {
      key,
      city: d.destination.city,
      country: d.destination.country,
      lat: d.destination.lat ?? NaN,
      lon: d.destination.lon ?? NaN,
      deals: 0,
      bestCpp: null,
      demoOnly: true,
      region: d.destination.region,
      lowestPoints: null,
      tags: new Set<string>(),
    }
    g.deals++
    if (value != null && (g.bestCpp == null || value > g.bestCpp)) g.bestCpp = value
    if (i.valuation.chasePoints != null && (g.lowestPoints == null || i.valuation.chasePoints < g.lowestPoints)) g.lowestPoints = i.valuation.chasePoints
    if (d.sourceKind !== 'demo') g.demoOnly = false
    d.tags.forEach((t) => g.tags.add(t))
    groups.set(key, g)
  }
  const destinations = [...groups.values()].sort((a, b) => (b.bestCpp ?? -1) - (a.bestCpp ?? -1))
  const mapPoints = destinations.filter((g) => Number.isFinite(g.lat) && Number.isFinite(g.lon))
  const ranks = overallRanks(data.items, data.account.settings.demoMode, now)
  const ai = integrationStatus().ai && data.account.settings.aiEnabled

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Explore" title="Search the world" subtitle="Every destination where your data holds a deal or lead. Map dots and the list below show the same information." />

      <form method="get" className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <label htmlFor="eq" className="label">
            Search
          </label>
          <input id="eq" name="q" defaultValue={q} placeholder="City, country, airline or hotel" className="field" />
        </div>
        <div>
          <label htmlFor="er" className="label">
            Region
          </label>
          <select id="er" name="region" defaultValue={region ?? ''} className="field">
            <option value="">Anywhere</option>
            {REGIONS.map((r) => (
              <option key={r} value={r}>
                {REGION_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="et" className="label">
            Experience
          </label>
          <select id="et" name="tag" defaultValue={tag ?? ''} className="field">
            <option value="">Any</option>
            {TRAVEL_TAGS.map((t) => (
              <option key={t} value={t}>
                {TAG_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="ep" className="label">
            Max Chase points
          </label>
          <input id="ep" name="maxPoints" type="number" min={0} step={5000} defaultValue={maxPoints ?? ''} className="field w-36" />
        </div>
        <button type="submit" className="h-10 rounded-full bg-primary px-4 text-sm font-medium text-primary-ink">
          Search
        </button>
      </form>

      <Card className="p-4">
        <WorldMap points={mapPoints} />
      </Card>

      {destination ? (
        <section>
          <SectionTitle aside={<LinkButton href="/explore" variant="ghost" size="sm">All destinations</LinkButton>}>{destination}</SectionTitle>
          <DealList items={filtered.map((e) => toCardData(e, { now, rank: ranks.get(e.deal.id) ?? null, saved: data.savedIds.has(e.deal.id), programName: null }))} emptyText="No deals here yet." />
        </section>
      ) : (
        <section>
          <SectionTitle aside={<span className="text-sm text-muted">{destinations.length} destinations</span>}>Destinations</SectionTitle>
          {destinations.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">No destinations match. Try a broader search, or add a deal you found.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {destinations.map((g) => (
                <li key={g.key}>
                  <a href={`/explore?destination=${encodeURIComponent(g.city)}`} className="block rounded-2xl border border-line bg-surface p-4 hover:border-primary">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold">
                        {g.city}
                        <span className="font-normal text-muted">, {g.country}</span>
                      </span>
                      {g.demoOnly && <Badge tone="gold">demo</Badge>}
                    </div>
                    <p className="text-xs text-muted">
                      {REGION_LABELS[g.region]} · {g.deals} deal{g.deals === 1 ? '' : 's'}
                    </p>
                    <p className="mt-1 text-sm">
                      Best <span className="font-semibold text-primary">{cpp(g.bestCpp)}</span> · from {points(g.lowestPoints)} pts
                    </p>
                    <p className="mt-1 truncate text-xs text-faint">{[...g.tags].map((t) => TAG_LABELS[t as TravelTag] ?? t).join(' · ')}</p>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section>
        <SectionTitle>Destination ideas</SectionTitle>
        {ai ? (
          <Ideas />
        ) : (
          <p className="text-sm text-muted">Turn on AI in Settings (requires an Anthropic API key) to get destination ideas matched to your travel profile. Ideas never include prices or availability.</p>
        )}
      </section>

      <section>
        <SectionTitle aside={<span className="text-xs text-muted">Reviewed {PLAYBOOK_REVIEWED} · research notes, not live data</span>}>Sweet-spot playbook</SectionTitle>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PLAYBOOK.map((p) => (
            <li key={p.id}>
              <Card className="h-full p-4 text-sm">
                <p className="font-semibold">{p.title}</p>
                <p className="mt-1 text-muted">{p.body}</p>
                <LinkButton href={p.action.href} variant="ghost" size="sm" className="mt-2 -ml-3">
                  {p.action.label} →
                </LinkButton>
              </Card>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
