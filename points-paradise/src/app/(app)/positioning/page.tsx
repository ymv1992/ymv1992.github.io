import type { Metadata } from 'next'
import Link from 'next/link'
import { estimateFlightMinutes, haversineKm } from '@/lib/engine/geo'
import { cpp, minutesLabel, points } from '@/lib/format'
import { getAirport } from '@/lib/geo/airports'
import { getEvaluation } from '@/lib/server/loaders'
import { PositioningCalculator, type PositioningDefaults } from '@/components/positioning/positioning-calculator'
import { Badge, PageHeader, SectionTitle } from '@/components/ui'

export const metadata: Metadata = { title: 'Positioning' }

export default async function PositioningPage({ searchParams }: { searchParams: Promise<{ a?: string; b?: string }> }) {
  const sp = await searchParams
  const data = await getEvaluation()
  const homes = data.account.profile.homeAirports
  const a = sp.a ? data.byId.get(sp.a) : undefined
  const b = sp.b ? data.byId.get(sp.b) : undefined

  // Awards that leave from outside the home airports, with a rough positioning estimate.
  const candidates = data.items
    .filter(
      (e) =>
        e.deal.kind === 'flight' &&
        e.deal.originAirport &&
        !homes.includes(e.deal.originAirport) &&
        // Return legs into a home airport are not positioning candidates.
        !(e.deal.destination.airport && homes.includes(e.deal.destination.airport)) &&
        (e.status === 'verified_live' || e.status === 'recently_verified' || e.status === 'cached' || e.status === 'unverified_lead' || e.status === 'demo'))
    .map((e) => {
      const origin = getAirport(e.deal.originAirport)
      const nearest = homes
        .map((h) => getAirport(h))
        .filter((x) => x !== null)
        .map((h) => ({ h, km: origin ? haversineKm(h.lat, h.lon, origin.lat, origin.lon) : Infinity }))
        .sort((x, y) => x.km - y.km)[0]
      const sameDest = data.items.filter((o) => o.deal.kind === 'flight' && o.deal.destination.airport === e.deal.destination.airport && o.deal.originAirport && homes.includes(o.deal.originAirport) && o.deal.flight?.cabin === e.deal.flight?.cabin)
      return { e, nearest, homeAlt: sameDest[0] ?? null }
    })

  const defaults: PositioningDefaults = {
    homeLabel: 'From home',
    homeAirport: a?.deal.originAirport ?? homes[0] ?? 'LAX',
    homePoints: a?.valuation.chasePoints ?? 0,
    homeCash: a?.deal.mandatoryCashUsd ?? 0,
    homeMinutes: a?.deal.flight?.durationMinutes ?? 0,
    altLabel: 'Positioning',
    altAirport: b?.deal.originAirport ?? '',
    altPoints: b?.valuation.chasePoints ?? 0,
    altCash: b?.deal.mandatoryCashUsd ?? 0,
    altMinutes: b?.deal.flight?.durationMinutes ?? 0,
    extraMinutes: 0,
    international: false,
  }
  if (b?.deal.originAirport) {
    const o = getAirport(b.deal.originAirport)
    const h = getAirport(defaults.homeAirport)
    if (o && h) {
      defaults.extraMinutes = estimateFlightMinutes(haversineKm(h.lat, h.lon, o.lat, o.lon)) + 120
      defaults.international = o.countryCode !== h.countryCode
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Positioning optimizer"
        title="Is another departure airport worth it?"
        subtitle="Compare departing from home with flying to another gateway first. Every cost is explicit; a positioning plan is only recommended when the savings justify the time and risk."
      />
      {(a || b) && (
        <p className="text-sm text-muted">
          Prefilled from {a ? <Link className="text-primary" href={`/deals/${a.deal.id}`}>{a.deal.title}</Link> : 'your home airport'} and {b ? <Link className="text-primary" href={`/deals/${b.deal.id}`}>{b.deal.title}</Link> : '—'}.
          Positioning costs start at $0 — enter the real fare you find. {(a?.deal.sourceKind === 'demo' || b?.deal.sourceKind === 'demo') && <Badge tone="gold">Uses demo data</Badge>}
        </p>
      )}
      <PositioningCalculator key={`${sp.a ?? ''}-${sp.b ?? ''}`} defaults={defaults} pointValueCents={data.account.settings.pointFloorCents} />

      <section>
        <SectionTitle>Awards that need positioning</SectionTitle>
        {candidates.length === 0 ? (
          <p className="text-sm text-muted">No awards in your data depart outside {homes.join(', ')}.</p>
        ) : (
          <ul className="divide-y divide-line rounded-2xl border border-line bg-surface text-sm">
            {candidates.map(({ e, nearest, homeAlt }) => (
              <li key={e.deal.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <span>
                  {e.deal.sourceKind === 'demo' && <Badge tone="gold">DEMO</Badge>}{' '}
                  <Link href={`/deals/${e.deal.id}`} className="font-semibold hover:text-primary">
                    {e.deal.originAirport} → {e.deal.destination.airport} · {e.deal.providerName}
                  </Link>
                  <span className="block text-xs text-muted">
                    {points(e.valuation.chasePoints)} pts · {cpp(e.valuation.practicalCpp ?? e.valuation.headlineCpp)}
                    {nearest && Number.isFinite(nearest.km) && ` · from ${nearest.h.iata}: ~${Math.round(nearest.km).toLocaleString('en-US')} km, about ${minutesLabel(estimateFlightMinutes(nearest.km))} flying (estimate)`}
                  </span>
                </span>
                <Link className="text-primary" href={`/positioning?${homeAlt ? `a=${homeAlt.deal.id}&` : ''}b=${e.deal.id}`}>
                  Compare
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
