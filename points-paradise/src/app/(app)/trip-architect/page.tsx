import type { Metadata } from 'next'
import Link from 'next/link'
import { CABIN_LABELS } from '@/lib/domain/constants'
import { buildTrips, type TripPlan } from '@/lib/engine/trip'
import { parseTripRequest } from '@/lib/engine/trip-request'
import { cpp, dateRange, points, usd } from '@/lib/format'
import { integrationStatus } from '@/lib/server/config'
import { getEvaluation } from '@/lib/server/loaders'
import { TripNarrative } from '@/components/trip/trip-narrative'
import { Badge, Card, PageHeader, SectionTitle, StatusBadge } from '@/components/ui'

export const metadata: Metadata = { title: 'Trip Architect' }

const STATUS = {
  bookable: { label: 'All parts verified recently', tone: 'ok' },
  hypothetical: { label: 'Hypothetical — some parts unverified', tone: 'warn' },
  incomplete: { label: 'Incomplete — missing parts', tone: 'danger' },
  demo: { label: 'Demo — fictional', tone: 'gold' },
} as const

const ROLE = { outbound: 'Outbound flight', return: 'Return flight', hotel: 'Hotel', package: 'Package' } as const

type SP = Promise<Record<string, string | undefined>>

function int(v: string | undefined, fallback: number, min = 0, max = 10_000_000): number {
  const n = Number(v)
  return Number.isFinite(n) && v !== undefined && v !== '' ? Math.min(max, Math.max(min, Math.round(n))) : fallback
}

export default async function TripArchitectPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams
  const data = await getEvaluation()
  const now = data.ctx.now
  const today = now.toISOString().slice(0, 10)
  const parsed = sp.request ? parseTripRequest(sp.request) : null
  const months = int(sp.months, parsed?.months ?? 6, 1, 24)
  const req = {
    budget: {
      pointsBalance: int(sp.points, parsed?.points ?? data.account.wallet.chaseBalance),
      maxCashUsd: int(sp.cash, parsed?.cashUsd ?? data.account.profile.maxCashUsd),
    },
    homeAirports: data.account.profile.homeAirports,
    windowStart: today,
    windowEnd: new Date(now.getTime() + months * 30.44 * 86_400_000).toISOString().slice(0, 10),
    minNights: int(sp.minNights, parsed?.minNights ?? data.account.profile.tripNightsMin ?? 2, 1, 60),
    maxNights: int(sp.maxNights, parsed?.maxNights ?? data.account.profile.tripNightsMax ?? 10, 1, 60),
    travelers: int(sp.travelers, parsed?.travelers ?? data.account.settings.travelers, 1, 12),
    foodPerPersonPerDayUsd: data.account.settings.foodPerPersonPerDayUsd,
    allowPositioning: sp.positioning === 'on',
    includeDemo: data.account.settings.demoMode,
    maxPlans: 12,
  }
  const submitted = Object.keys(sp).length > 0
  const { plans, overBudget } = submitted ? buildTrips(data.items, req) : { plans: [] as TripPlan[], overBudget: 0 }
  const ai = integrationStatus().ai && data.account.settings.aiEnabled

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Trip Architect"
        title="Build an extraordinary trip"
        subtitle="Combines the flights and hotels in your data, compares paying with points or cash for each part, and stays within your budget. Missing or unverified parts are always labelled."
      />
      <Card className="p-5">
        <form method="get" className="space-y-4">
          <div>
            <label htmlFor="request" className="label">
              Describe the trip (optional)
            </label>
            <textarea
              id="request"
              name="request"
              defaultValue={sp.request ?? ''}
              className="field min-h-20"
              placeholder="I have 150,000 Chase points and $1,000. Find me the most extraordinary vacation I can take in the next six months."
            />
            {parsed && parsed.interpreted.length > 0 && <p className="mt-1 text-xs text-muted">Understood: {parsed.interpreted.join(' · ')}. Fields below override this.</p>}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {(
              [
                ['points', 'Chase points', sp.points],
                ['cash', 'Cash budget (USD)', sp.cash],
                ['months', 'Within months', sp.months],
                ['minNights', 'Min nights', sp.minNights],
                ['maxNights', 'Max nights', sp.maxNights],
                ['travelers', 'Travelers', sp.travelers],
              ] as const
            ).map(([name, label, value]) => (
              <div key={name}>
                <label htmlFor={`t-${name}`} className="label">
                  {label}
                </label>
                <input id={`t-${name}`} name={name} type="number" min={0} defaultValue={value ?? ''} placeholder={String(name === 'points' ? req.budget.pointsBalance : name === 'cash' ? req.budget.maxCashUsd : name === 'months' ? months : name === 'minNights' ? req.minNights : name === 'maxNights' ? req.maxNights : req.travelers)} className="field" />
              </div>
            ))}
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" name="positioning" defaultChecked={sp.positioning === 'on'} /> Allow positioning
            </label>
          </div>
          <button type="submit" className="h-11 rounded-full bg-primary px-6 text-sm font-medium text-primary-ink">
            Design trips
          </button>
        </form>
      </Card>

      {submitted && (
        <section>
          <SectionTitle aside={<span className="text-sm text-muted">{plans.length} within budget{overBudget ? ` · ${overBudget} combinations over budget` : ''}</span>}>Candidate trips</SectionTitle>
          {plans.length === 0 ? (
            <Card className="p-6 text-sm text-muted">
              <p>No trip fits these limits with the flights and hotels currently in your data.</p>
              <ul className="mt-2 list-disc pl-5">
                {overBudget > 0 && <li>{overBudget} combinations exist but exceed the points or cash budget — try a larger budget or shorter stay.</li>}
                <li>Add outbound and return flights and a hotel for the same destination and dates (manually or with award search).</li>
                <li>Allow positioning to include awards from other airports.</li>
              </ul>
            </Card>
          ) : (
            <ol className="space-y-4">
              {plans.map((p, idx) => {
                const facts = {
                  destination: p.destination,
                  dates: dateRange(p.startDate, p.endDate),
                  nights: p.nights,
                  strategy: p.strategy,
                  status: STATUS[p.status].label,
                  totalChasePoints: p.totals.chasePoints,
                  cashForBookings: p.totals.cashUsd,
                  foodEstimate: p.totals.foodUsd,
                  comparableCashValue: p.totals.comparableUsd,
                  effectiveCentsPerPoint: p.effectiveCpp != null ? Number(p.effectiveCpp.toFixed(2)) : null,
                  components: p.components.map((c) => ({ role: c.role, provider: c.item.deal.providerName, payWith: c.payWith, verified: c.item.statusLabel })),
                  missing: p.missing,
                }
                return (
                  <li key={p.id}>
                    <Card className="p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold tracking-wider text-gold uppercase">Option {idx + 1}</p>
                          <h3 className="font-display text-2xl">{p.destination}</h3>
                          <p className="text-sm text-muted">
                            {dateRange(p.startDate, p.endDate)}
                            {p.nights != null && ` · ${p.nights} nights`} · {p.strategy}
                            {p.usesPositioning && ' · includes positioning'}
                          </p>
                        </div>
                        <Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-3 rounded-2xl bg-surface-2 p-3 text-sm sm:grid-cols-5">
                        <div>
                          <div className="text-[11px] text-faint uppercase">Chase points</div>
                          <div className="text-lg font-semibold">{points(p.totals.chasePoints)}</div>
                          <div className="text-[11px] text-faint">{points(p.budget.pointsRemaining)} left</div>
                        </div>
                        <div>
                          <div className="text-[11px] text-faint uppercase">Cash to book</div>
                          <div className="text-lg font-semibold">{usd(p.totals.cashUsd)}</div>
                          <div className="text-[11px] text-faint">{usd(p.budget.cashRemainingUsd)} left</div>
                        </div>
                        <div>
                          <div className="text-[11px] text-faint uppercase">Food (estimate)</div>
                          <div className="text-lg font-semibold">{usd(p.totals.foodUsd)}</div>
                          <div className="text-[11px] text-faint">{usd(req.foodPerPersonPerDayUsd)}/person/day</div>
                        </div>
                        <div>
                          <div className="text-[11px] text-faint uppercase">Cash value replaced</div>
                          <div className="text-lg font-semibold">{usd(p.totals.comparableUsd)}</div>
                        </div>
                        <div>
                          <div className="text-[11px] text-faint uppercase">Effective value</div>
                          <div className="text-lg font-semibold text-primary">{cpp(p.effectiveCpp)}</div>
                        </div>
                      </div>
                      <ul className="mt-4 divide-y divide-line text-sm">
                        {p.components.map((c) => (
                          <li key={`${c.role}-${c.item.deal.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                            <span>
                              <span className="text-faint">{ROLE[c.role]}: </span>
                              <Link href={`/deals/${c.item.deal.id}`} className="font-medium hover:text-primary">
                                {c.item.deal.providerName}
                              </Link>
                              <span className="text-muted">
                                {' '}
                                · {dateRange(c.item.deal.travelStart, c.item.deal.travelEnd)}
                                {c.item.deal.flight && ` · ${c.item.deal.originAirport}→${c.item.deal.destination.airport} ${CABIN_LABELS[c.item.deal.flight.cabin]}`}
                                {c.item.deal.hotel && ` · ${c.item.deal.hotel.roomCategory ?? c.item.deal.hotel.roomType}`}
                              </span>
                            </span>
                            <span className="flex items-center gap-2">
                              {c.item.deal.sourceKind === 'demo' ? <Badge tone="gold">DEMO</Badge> : <StatusBadge status={c.item.status} />}
                              <Badge tone={c.payWith === 'points' ? 'primary' : 'neutral'}>{c.payWith === 'points' ? `${points(c.chasePoints)} pts + ${usd(c.cashUsd)}` : `${usd(c.cashUsd)} cash`}</Badge>
                            </span>
                          </li>
                        ))}
                      </ul>
                      {p.components.some((c) => c.item.deal.hotel?.mandatoryTransfer) && (
                        <p className="mt-2 text-xs text-muted">Mandatory transfers: {p.components.map((c) => c.item.deal.hotel?.mandatoryTransfer).filter(Boolean).join('; ')} (included in cash if recorded).</p>
                      )}
                      {p.missing.length > 0 && (
                        <ul className="mt-3 space-y-1 text-sm text-warn">
                          {p.missing.map((m) => (
                            <li key={m}>⚠ {m}</li>
                          ))}
                        </ul>
                      )}
                      <p className="mt-3 text-xs text-muted">
                        Book each part from its deal page — every one has a step-by-step guide. Ground transport and experiences are not priced unless you add them.
                      </p>
                      {ai && p.status !== 'demo' && (
                        <div className="mt-3">
                          <TripNarrative facts={facts} />
                        </div>
                      )}
                    </Card>
                  </li>
                )
              })}
            </ol>
          )}
        </section>
      )}
    </div>
  )
}
