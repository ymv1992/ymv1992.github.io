import type { Metadata } from 'next'
import Link from 'next/link'
import { inArray } from 'drizzle-orm'
import { dealPriceHistory } from '@/lib/db/schema'
import { CABINS, CABIN_LABELS, type Cabin } from '@/lib/domain/constants'
import { parseCalendarSelection } from '@/lib/view/calendar-selection'
import { predict, type Observation } from '@/lib/engine/history'
import { median } from '@/lib/engine/valuation'
import { points } from '@/lib/format'
import { integrationStatus } from '@/lib/server/config'
import { getEvaluationWithArchive } from '@/lib/server/loaders'
import { AwardCalendar, type CalendarCell } from '@/components/calendar/award-calendar'
import { AwardSearchForm } from '@/components/calendar/award-search-form'
import { HotelSearchForm } from '@/components/calendar/hotel-search-form'
import { SearchPanel } from '@/components/calendar/search-panel'
import { DISCOVERY_DESTINATIONS } from '@/lib/jobs/discovery'
import { PriceHistoryChart } from '@/components/charts/price-history-chart'
import { Badge, Card, PageHeader, SectionTitle } from '@/components/ui'

export const metadata: Metadata = { title: 'Award Calendar' }
// Searches and cash lookups run as server actions on this page and can take a while.
export const maxDuration = 60

function addMonths(ym: string, n: number): string {
  const d = new Date(`${ym}-01T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + n)
  return d.toISOString().slice(0, 7)
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ key?: string; cabin?: string }> }) {
  const sp = await searchParams
  const data = await getEvaluationWithArchive()
  const now = data.ctx.now
  const tz = data.account.settings.timezone
  const wanted = parseCalendarSelection(sp)

  // Selectable series: flight routes (every cabin; tabs pick one), and hotel properties.
  const series = new Map<string, { label: string; items: typeof data.items; demo: boolean }>()
  for (const e of data.items) {
    const d = e.deal
    const key = d.kind === 'flight' && d.flight && d.originAirport && d.destination.airport ? `f:${d.originAirport}:${d.destination.airport}` : d.hotel ? `h:${d.hotel.property}` : null
    if (!key) continue
    const label = d.kind === 'flight' && d.flight ? `${d.originAirport} → ${d.destination.airport}` : `${d.hotel!.property}`
    const s = series.get(key) ?? { label, items: [], demo: true }
    s.items.push(e)
    if (d.sourceKind !== 'demo') s.demo = false
    series.set(key, s)
  }
  const keys = [...series.keys()].sort((a, b) => series.get(b)!.items.length - series.get(a)!.items.length)
  const selectedKey = wanted.key && series.has(wanted.key) ? wanted.key : keys[0]
  const route = selectedKey ? series.get(selectedKey)! : null

  // Cabin tabs for a route: how many dates each cabin has and its lowest price.
  const tabs: { cabin: Cabin; dates: number; lowest: number | null }[] = []
  if (route && selectedKey?.startsWith('f:')) {
    for (const cabin of CABINS) {
      const list = route.items.filter((e) => e.deal.flight?.cabin === cabin)
      if (!list.length) continue
      const prices = list.filter((e) => e.deal.availability !== 'unavailable' && e.deal.programPoints != null).map((e) => e.deal.programPoints!)
      tabs.push({ cabin, dates: new Set(list.map((e) => e.deal.travelStart)).size, lowest: prices.length ? Math.min(...prices) : null })
    }
  }
  const selectedCabin = tabs.length ? (tabs.find((t) => t.cabin === wanted.cabin) ?? [...tabs].sort((a, b) => b.dates - a.dates)[0]!).cabin : null
  const selected = route
    ? {
        ...route,
        label: selectedCabin ? `${route.label} · ${CABIN_LABELS[selectedCabin]}` : route.label,
        items: selectedCabin ? route.items.filter((e) => e.deal.flight?.cabin === selectedCabin) : route.items,
      }
    : null

  let cells: CalendarCell[] = []
  const months: string[] = []
  let historyPoints: { t: string; points: number | null; available: boolean; source: string }[] = []
  let prediction: ReturnType<typeof predict> | null = null
  const seasonal: { month: string; count: number; min: number | null; median: number | null }[] = []

  if (selected) {
    const byDate = new Map<string, CalendarCell>()
    for (const e of selected.items) {
      const date = e.deal.travelStart
      if (!date) continue
      const pts = e.deal.availability === 'unavailable' ? null : e.deal.programPoints
      const prev = byDate.get(date)
      if (!prev || (pts != null && (prev.points == null || pts < prev.points))) {
        byDate.set(date, { date, points: pts, dealId: e.deal.id, status: pts == null ? 'unavailable' : 'available', isDemo: e.deal.sourceKind === 'demo', cash: e.deal.mandatoryCashUsd })
      }
    }
    cells = [...byDate.values()]
    const thisMonth = now.toISOString().slice(0, 7)
    const dataMonths = cells.map((c) => c.date.slice(0, 7)).filter((m) => m >= thisMonth)
    const last = dataMonths.length ? dataMonths.sort().at(-1)! : addMonths(thisMonth, 2)
    for (let m = thisMonth; m <= last && months.length < 12; m = addMonths(m, 1)) months.push(m)

    const rows = await data.db
      .select()
      .from(dealPriceHistory)
      .where(inArray(dealPriceHistory.dealId, selected.items.map((i) => i.deal.id)))
    // Lowest observed price per observation day across the route/property.
    const byDay = new Map<string, { points: number | null; available: boolean }>()
    for (const r of rows) {
      const day = r.observedAt.toISOString().slice(0, 10)
      const cur = byDay.get(day)
      const available = r.availability === 'available' && r.programPoints != null
      if (!cur || (available && (cur.points == null || r.programPoints! < cur.points))) byDay.set(day, { points: available ? r.programPoints : null, available })
    }
    historyPoints = [...byDay.entries()].sort().map(([day, v]) => ({ t: `${day}T12:00:00Z`, points: v.points, available: v.available, source: selected.demo ? 'demo' : 'observed' }))
    const obs: Observation[] = rows.map((r) => ({ observedAt: r.observedAt, programPoints: r.programPoints, cashUsd: r.cashUsd, mandatoryCashUsd: r.mandatoryCashUsd, availability: r.availability as Observation['availability'] }))
    const cheapestNow = cells.filter((c) => c.points != null && c.date >= now.toISOString().slice(0, 10)).map((c) => c.points!)
    prediction = predict(obs, cheapestNow.length ? Math.min(...cheapestNow) : null)

    const byMonth = new Map<string, number[]>()
    for (const c of cells) {
      if (c.points == null) continue
      const m = c.date.slice(0, 7)
      byMonth.set(m, [...(byMonth.get(m) ?? []), c.points])
    }
    for (const [month, list] of [...byMonth.entries()].sort()) seasonal.push({ month, count: list.length, min: Math.min(...list), median: median(list) })
  }

  const today = now.toISOString().slice(0, 10)
  const day = (n: number) => new Date(now.getTime() + n * 86_400_000).toISOString().slice(0, 10)
  const in60 = day(60)
  const in7 = day(7)
  const in74 = day(74)

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Award Calendar" title="Flexible dates" subtitle="Lowest points observed per travel date, plus how prices have moved over time. Cached and historical prices are labelled — re-check before booking." />

      <Card id="search" className="scroll-mt-20 p-5">
        <SectionTitle>Search award space</SectionTitle>
        {integrationStatus().seatsAero ? (
          <SearchPanel
            flights={
              <AwardSearchForm
                defaults={{ origin: data.account.profile.homeAirports[0] ?? 'LAX', destination: '', cabin: 'all', startDate: today, endDate: in60, returnStart: in7, returnEnd: in74 }}
                homeAirports={data.account.profile.homeAirports}
                destinationCount={DISCOVERY_DESTINATIONS.reduce((n, g) => n + g.airports.length, 0)}
                canPrice={integrationStatus().serpApi}
              />
            }
            hotels={<HotelSearchForm defaults={{ startDate: today, endDate: in60, nights: Math.min(5, Math.max(1, data.account.profile.tripNightsMin ?? 3)) }} />}
          />
        ) : (
          <p className="text-sm text-muted">
            Live calendar search needs a seats.aero Pro API key (personal use, about $10/month — see Settings → Data sources). Without it, the calendar is built from deals you add and their price history.
          </p>
        )}
      </Card>

      {keys.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">No dated deals yet. Add deals or turn on demo data to see the calendar.</p>
      ) : (
        <>
          <form method="get" className="flex flex-wrap items-end gap-2">
            {/* Keep the cabin when switching routes; a route without it shows its busiest cabin. */}
            {selectedCabin && <input type="hidden" name="cabin" value={selectedCabin} />}
            <div>
              <label htmlFor="ck" className="label">
                Route or property
              </label>
              <select id="ck" name="key" defaultValue={selectedKey} className="field">
                {keys.map((k) => (
                  <option key={k} value={k}>
                    {series.get(k)!.label}
                    {series.get(k)!.demo ? ' (demo)' : ''} — {series.get(k)!.items.length}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="h-10 rounded-full border border-line bg-surface px-4 text-sm">
              Show
            </button>
          </form>

          {selected && (
            <Card className="p-5">
              <SectionTitle aside={selected.demo ? <Badge tone="gold">Demo data</Badge> : undefined}>{selected.label}</SectionTitle>
              {tabs.length > 0 && (
                <nav aria-label="Cabin" className="-mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1">
                  {tabs.map((t) => {
                    const active = t.cabin === selectedCabin
                    return (
                      <Link
                        key={t.cabin}
                        href={{ query: { key: selectedKey, cabin: t.cabin } }}
                        scroll={false}
                        aria-current={active ? 'page' : undefined}
                        className={`shrink-0 rounded-xl border px-3 py-1.5 text-sm ${active ? 'border-primary bg-primary text-primary-ink' : 'border-line bg-surface hover:bg-surface-2'}`}
                      >
                        <span className="font-semibold">{CABIN_LABELS[t.cabin]}</span>
                        <span className={`block text-xs ${active ? 'opacity-90' : 'text-muted'}`}>
                          {t.dates} date{t.dates === 1 ? '' : 's'}
                          {t.lowest != null ? ` · from ${points(t.lowest)}` : ''}
                        </span>
                      </Link>
                    )
                  })}
                </nav>
              )}
              <AwardCalendar cells={cells} months={months} label={selected.label} />
            </Card>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="p-5">
              <SectionTitle>Price history</SectionTitle>
              {historyPoints.length >= 2 ? (
                <PriceHistoryChart data={historyPoints} label="Lowest points observed each day across this selection" timeZone={tz} />
              ) : (
                <p className="text-sm text-muted">Not enough observations yet. History builds as deals are re-checked.</p>
              )}
            </Card>
            <Card className="p-5">
              <SectionTitle>Outlook &amp; seasons</SectionTitle>
              {prediction && (prediction.reliable ? <p className="text-sm">{prediction.explanation}</p> : <p className="text-sm text-muted">{prediction.reason}</p>)}
              {seasonal.length > 0 && (
                <table className="mt-4 w-full text-sm">
                  <thead className="text-left text-xs text-faint">
                    <tr>
                      <th className="py-1 font-medium">Travel month</th>
                      <th className="py-1 font-medium">Dates priced</th>
                      <th className="py-1 font-medium">Lowest</th>
                      <th className="py-1 font-medium">Median</th>
                    </tr>
                  </thead>
                  <tbody className="tabular">
                    {seasonal.map((s) => (
                      <tr key={s.month} className="border-t border-line">
                        <td className="py-1.5">{s.month}</td>
                        <td className="py-1.5">{s.count}</td>
                        <td className="py-1.5">{points(s.min)}</td>
                        <td className="py-1.5">{points(s.median)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
