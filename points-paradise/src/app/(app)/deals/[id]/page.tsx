import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { watchlists } from '@/lib/db/schema'
import { priceHistory, relatedHistory } from '@/lib/data/deals'
import { CABIN_LABELS, CASH_SOURCE_LABELS, CATEGORY_DEFS, CHASE_TRAVEL_PROGRAM_ID, ROOM_TYPE_LABELS, SEAT_TYPE_LABELS, SOURCE_KIND_LABELS, cardLabel, type CardType } from '@/lib/domain/constants'
import { bookingChecklist, CHASE_HOME_URL } from '@/lib/engine/booking'
import { predict } from '@/lib/engine/history'
import { formatRatio } from '@/lib/engine/transfer'
import { formatAge, isBookableStatus } from '@/lib/engine/status'
import { cpp, dateRange, dateTime, minutesLabel, points, usd } from '@/lib/format'
import { getEvaluationWithArchive } from '@/lib/server/loaders'
import { overallRanks } from '@/lib/view/feed'
import { productLine, defaultWhy, availabilityRisk } from '@/lib/view/deal-view'
import { BookingGuide } from '@/components/deal/booking-guide'
import { Countdown } from '@/components/deal/countdown'
import { DealActions } from '@/components/deal/deal-actions'
import { DealImage } from '@/components/deal/deal-card'
import { PriceHistoryChart } from '@/components/charts/price-history-chart'
import { Badge, Card, ExternalLink, Notice, SectionTitle, Stat, StatusBadge } from '@/components/ui'
import { DealExplainer } from '@/components/deal/deal-explainer'
import { integrationStatus } from '@/lib/server/config'

export const metadata: Metadata = { title: 'Deal analysis' }

function Row({ label, value, warn }: { label: string; value: React.ReactNode; warn?: boolean }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line py-2 text-sm last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className={warn ? 'text-right font-medium text-warn' : 'text-right font-medium'}>{value}</dd>
    </div>
  )
}

function yesNo(v: boolean | null | undefined, unknown = 'Not verified') {
  return v == null ? unknown : v ? 'Yes' : 'No'
}

export default async function DealPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ merged?: string }> }) {
  const { id } = await params
  const { merged } = await searchParams
  const data = await getEvaluationWithArchive()
  const e = data.byId.get(id)
  if (!e) notFound()
  const { deal, valuation: v } = e
  const now = data.ctx.now
  const tz = data.account.settings.timezone
  const isDemo = deal.sourceKind === 'demo'
  const partner = deal.programId ? (data.partners.get(deal.programId) ?? null) : null
  const programName = deal.programId === CHASE_TRAVEL_PROGRAM_ID ? 'Chase Travel' : (partner?.programName ?? deal.programId ?? 'Unknown program')
  const rank = overallRanks(data.items.filter((i) => !i.deal.archivedAt), data.account.settings.demoMode, now).get(deal.id) ?? null
  const history = await priceHistory(data.db, deal.id)
  const related = await relatedHistory(data.db, deal)
  const prediction = predict(
    related.map((h) => ({ observedAt: h.observedAt, programPoints: h.programPoints, cashUsd: h.cashUsd, mandatoryCashUsd: h.mandatoryCashUsd, availability: h.availability as 'available' | 'unavailable' | 'unknown' })),
    deal.programPoints,
  )
  const [watch] = await data.db
    .select({ id: watchlists.id, auto: watchlists.autoCheckSupported })
    .from(watchlists)
    .where(and(eq(watchlists.userId, data.userId), eq(watchlists.dealId, deal.id), eq(watchlists.active, true)))
  const steps = bookingChecklist(deal, v, partner)
  const risk = availabilityRisk(e)
  const card = data.account.wallet.cardType as CardType
  const balance = data.account.wallet.chaseBalance
  const homeAirports = data.account.profile.homeAirports

  // Same destination & cabin from other departure airports, for positioning comparisons.
  const alternatives =
    deal.kind === 'flight' && deal.flight
      ? data.items.filter(
          (o) =>
            o.deal.id !== deal.id &&
            o.deal.kind === 'flight' &&
            !o.deal.archivedAt &&
            o.deal.destination.airport === deal.destination.airport &&
            o.deal.flight?.cabin === deal.flight?.cabin &&
            o.deal.originAirport !== deal.originAirport &&
            (o.deal.sourceKind === 'demo') === isDemo,
        )
      : []
  const fromHome = deal.originAirport ? homeAirports.includes(deal.originAirport) : true

  return (
    <article className="space-y-6">
      {isDemo && (
        <Notice tone="gold" title="Fictional demonstration data">
          Everything on this page — airline or hotel, prices, availability, deadline and any transfer bonus — is invented to demonstrate the app. It is not a real or bookable offer.
        </Notice>
      )}
      {merged === '1' && (
        <Notice tone="primary" title="Matched an existing deal">
          A deal with the same route or property and dates already existed, so your entry was recorded as a new price observation instead of a duplicate.
        </Notice>
      )}
      {deal.archivedAt && (
        <Notice tone="warn" title="In the History archive">
          Archived {formatAge(deal.archivedAt, now)} ({deal.archiveReason?.replace(/_/g, ' ') ?? 'archived'}). Historical availability is not current availability.
        </Notice>
      )}

      <div className="relative overflow-hidden rounded-3xl border border-line">
        <div className="h-64 sm:h-80">
          <DealImage d={{ id: deal.id, imageUrl: deal.imageUrl, imageCredit: deal.imageCredit, tags: deal.tags, kind: deal.kind, city: deal.destination.city }} />
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-navy/90 via-navy/30 to-transparent" />
        <div className="absolute right-5 bottom-5 left-5 text-white">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {isDemo ? <Badge className="bg-gold text-white dark:text-navy">DEMO · FICTIONAL</Badge> : <StatusBadge status={e.status} className="bg-surface/90" />}
            {rank != null && <Badge className="bg-navy/70 text-white">#{rank} in Top 100</Badge>}
            {e.categories.slice(0, 4).map((c) => (
              <Badge key={c} className="bg-white/15 text-white">
                {CATEGORY_DEFS.find((d) => d.slug === c)?.label ?? c}
              </Badge>
            ))}
          </div>
          <h1 className="font-display text-3xl leading-tight sm:text-5xl">
            {deal.destination.city}, {deal.destination.country}
          </h1>
          <p className="mt-1 text-white/85">
            {deal.providerName} · {productLine(e)} · {dateRange(deal.travelStart, deal.travelEnd)}
          </p>
        </div>
        {deal.imageCredit && <p className="absolute top-2 right-3 text-[10px] text-white/70">{deal.imageCredit}</p>}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card className="p-5">
            <SectionTitle>Value</SectionTitle>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Chase points" value={points(v.chasePoints)} hint={v.transfer?.bonusPercent ? `incl. ${v.transfer.bonusPercent}% ${v.transfer.bonusSource === 'illustrative' ? 'illustrative ' : ''}bonus` : undefined} emphasis />
              <Stat label="Cash required" value={usd(deal.mandatoryCashUsd)} hint="taxes, fees, mandatory costs" emphasis />
              <Stat label="Comparable cash" value={usd(deal.comparableCashUsd)} hint={CASH_SOURCE_LABELS[deal.comparableCashSource]} emphasis />
              <Stat label="Value per point" value={v.calculable ? cpp(v.practicalCpp ?? v.headlineCpp) : '—'} hint={v.calculable ? `${v.confidence} confidence` : 'cannot be calculated'} emphasis />
            </div>
            {v.calculable ? (
              <dl className="mt-5">
                <Row label="Headline CPP (comparable cash price)" value={cpp(v.headlineCpp)} />
                <Row label="Practical CPP (realistic alternative)" value={`${cpp(v.practicalCpp)} on ${usd(v.practicalCashUsd)}`} />
                <Row label="Cash you avoid paying" value={usd(v.cashSavingsUsd)} />
                <Row label="Formula" value={`(${usd(deal.comparableCashUsd)} − ${usd(deal.mandatoryCashUsd)}) ÷ ${points(v.chasePoints)} × 100`} />
              </dl>
            ) : (
              <div className="mt-4">
                <Notice tone="warn" title="Value cannot be reliably calculated">
                  <ul className="list-disc pl-5">
                    {v.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </Notice>
              </div>
            )}
            {v.flags.length > 0 && (
              <ul className="mt-4 space-y-1.5">
                {v.flags.map((f) => (
                  <li key={f.code} className="flex gap-2 text-sm text-warn">
                    <span aria-hidden>⚠</span>
                    {f.message}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 text-sm text-ink/90">{defaultWhy(e)}</p>
            {!isDemo && <DealExplainer dealId={deal.id} enabled={integrationStatus().ai && data.account.settings.aiEnabled} />}
          </Card>

          <Card className="p-5">
            <SectionTitle aside={<Link href={`/transfers?program=${deal.programId ?? ''}&points=${deal.programPoints ?? ''}`} className="text-sm text-primary">Open calculator</Link>}>
              Transfer calculation
            </SectionTitle>
            {v.transfer ? (
              <dl>
                <Row label="Book with" value={programName} />
                {v.transfer.isChaseTravel ? (
                  <Row label="Chase Travel points" value={points(v.transfer.requirement.chasePoints)} />
                ) : (
                  <>
                    <Row label={`${programName} points needed`} value={points(deal.programPoints)} />
                    <Row label={`Ratio for ${cardLabel(card)}`} value={v.transfer.ratio ? formatRatio(v.transfer.ratio) : '—'} />
                    <Row
                      label="Transfer bonus"
                      value={v.transfer.bonusPercent ? `${v.transfer.bonusPercent}% ${v.transfer.bonusSource === 'illustrative' ? '(illustrative — not real)' : ''}` : 'None active'}
                      warn={v.transfer.bonusSource === 'illustrative'}
                    />
                    <Row label="Chase points to transfer" value={points(v.transfer.requirement.chasePoints)} />
                    <Row label="Partner points received" value={`${points(v.transfer.requirement.partnerReceived)}${v.transfer.requirement.bonusPartnerPoints ? ` (incl. ${points(v.transfer.requirement.bonusPartnerPoints)} bonus)` : ''}`} />
                    <Row label="Left over in partner account" value={points(v.transfer.requirement.surplusPartnerPoints)} />
                    <Row label="Increment / minimum" value={partner ? `${points(partner.transferIncrement)} / ${points(partner.minTransfer)}` : '—'} />
                    <Row label="Processing time" value={v.transfer.processingTime ?? 'Unknown'} />
                  </>
                )}
                {balance >= v.transfer.requirement.chasePoints ? (
                  <Row label="Chase points remaining after" value={points(balance - v.transfer.requirement.chasePoints)} />
                ) : (
                  <Row label="Your balance is short by" value={`${points(v.transfer.requirement.chasePoints - balance)} Chase points`} warn />
                )}
              </dl>
            ) : (
              <p className="text-sm text-muted">No transfer calculation — the points program is unknown or the points price is missing.</p>
            )}
            {v.transfer?.warnings.map((w) => (
              <p key={w} className="mt-2 text-sm text-warn">
                ⚠ {w}
              </p>
            ))}
            <p className="mt-3 text-xs text-muted">Transfers are typically irreversible. Never transfer before confirming availability.</p>
          </Card>

          {deal.flight && (
            <Card className="p-5">
              <SectionTitle aside={<Badge tone={deal.flight.aircraftVerified ? 'ok' : 'warn'}>{deal.flight.aircraftVerified ? 'Aircraft verified' : 'Aircraft not verified'}</Badge>}>Flight &amp; seat</SectionTitle>
              <dl>
                <Row label="Route" value={`${deal.originAirport ?? '?'} → ${deal.destination.airport ?? '?'}`} />
                <Row label="Operating airline" value={deal.flight.operatingAirline ?? deal.providerName} />
                <Row label="Flight numbers" value={deal.flight.flightNumbers.length ? deal.flight.flightNumbers.join(', ') : 'Not recorded'} warn={!deal.flight.flightNumbers.length} />
                <Row label="Aircraft" value={deal.flight.aircraft ?? 'Not recorded'} warn={!deal.flight.aircraft} />
                <Row label="Cabin" value={CABIN_LABELS[deal.flight.cabin]} />
                <Row label="Seat" value={SEAT_TYPE_LABELS[deal.flight.seatType]} warn={deal.flight.seatType === 'unknown'} />
                <Row label="Direct aisle access" value={yesNo(deal.flight.directAisleAccess)} />
                <Row label="Stops" value={deal.flight.stops == null ? 'Unknown' : deal.flight.stops === 0 ? 'Nonstop' : String(deal.flight.stops)} />
                {deal.flight.connectionMinutes.length > 0 && <Row label="Connections" value={deal.flight.connectionMinutes.map(minutesLabel).join(', ')} />}
                <Row label="Duration" value={minutesLabel(deal.flight.durationMinutes)} />
                <Row label="Mixed cabin" value={yesNo(deal.flight.mixedCabin)} warn={!!deal.flight.mixedCabin} />
                {deal.flight.separateTickets && <Row label="Separate tickets" value="Yes — connections not protected" warn />}
              </dl>
              <p className="mt-3 text-xs text-muted">Aircraft and seat configurations can change after booking. Re-check the seat map before transferring points.</p>
            </Card>
          )}

          {deal.hotel && (
            <Card className="p-5">
              <SectionTitle aside={<Badge tone={deal.hotel.roomVerified ? 'ok' : 'warn'}>{deal.hotel.roomVerified ? 'Room verified' : 'Room not verified'}</Badge>}>Property &amp; room</SectionTitle>
              <dl>
                <Row label="Property" value={deal.hotel.property} />
                <Row label="Room booked with points" value={deal.hotel.roomCategory ?? ROOM_TYPE_LABELS[deal.hotel.roomType]} warn={deal.hotel.roomType === 'unknown'} />
                <Row label="Room type" value={ROOM_TYPE_LABELS[deal.hotel.roomType]} />
                <Row label="Standard award" value={yesNo(deal.hotel.isStandardAward, 'Unknown')} />
                {deal.hotel.programCategory && <Row label="Program category" value={deal.hotel.programCategory} />}
                <Row label="Guests" value={deal.hotel.guests ?? 'Unknown'} />
                <Row label="Nights" value={deal.nights ?? 'Unknown'} />
                <Row label="Meals" value={deal.hotel.meals ?? 'None recorded'} />
                <Row label="Resort fee" value={deal.hotel.resortFeeUsd != null ? usd(deal.hotel.resortFeeUsd) : 'Not recorded'} />
                <Row label="Mandatory transfer" value={deal.hotel.mandatoryTransfer ?? 'None recorded'} />
                <Row label="Cancellation" value={deal.hotel.cancellation ?? 'Not recorded'} />
              </dl>
              {deal.hotel.isStandardAward && (deal.hotel.roomType === 'villa' || deal.hotel.roomType === 'overwater_villa' || deal.hotel.roomType === 'pool_villa') && (
                <p className="mt-3 text-sm text-warn">⚠ A villa marked as a standard award is unusual — confirm the room category on the booking page.</p>
              )}
            </Card>
          )}

          {v.comparability.issues.length > 0 && (
            <Card className="p-5">
              <SectionTitle>Is the cash comparison like-for-like?</SectionTitle>
              <ul className="space-y-1.5 text-sm">
                {v.comparability.issues.map((i) => (
                  <li key={i.code} className={i.severity === 'major' ? 'text-danger' : 'text-muted'}>
                    <Badge tone={i.severity === 'major' ? 'danger' : i.severity === 'minor' ? 'warn' : 'neutral'}>{i.severity}</Badge> {i.message}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {history.length >= 2 && (
            <Card className="p-5">
              <SectionTitle>Price history</SectionTitle>
              <PriceHistoryChart
                timeZone={tz}
                label={`${programName} points for this ${deal.kind}, per observation`}
                data={history.map((h) => ({ t: h.observedAt.toISOString(), points: h.programPoints, available: h.availability === 'available', source: h.source }))}
              />
            </Card>
          )}

          {deal.kind === 'flight' && (
            <Card className="p-5">
              <SectionTitle aside={<Link href="/positioning" className="text-sm text-primary">Positioning optimizer</Link>}>Alternative departure airports</SectionTitle>
              {!fromHome && (
                <p className="mb-3 text-sm text-warn">This award departs {deal.originAirport}, outside your home airports ({homeAirports.join(', ')}). A positioning flight on a separate ticket is required.</p>
              )}
              {alternatives.length === 0 ? (
                <p className="text-sm text-muted">No other departure airports for this destination and cabin in your data yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-faint">
                    <tr>
                      <th className="py-1 font-medium">From</th>
                      <th className="py-1 font-medium">Chase pts</th>
                      <th className="py-1 font-medium">Cash</th>
                      <th className="py-1 font-medium">Value</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody className="tabular">
                    {[e, ...alternatives].map((o) => {
                      const home = o.deal.originAirport ? homeAirports.includes(o.deal.originAirport) : false
                      return (
                        <tr key={o.deal.id} className="border-t border-line">
                          <td className="py-2">
                            {o.deal.originAirport} {home ? <Badge tone="primary">home</Badge> : <Badge tone="warn">positioning</Badge>}
                            {o.deal.id === deal.id && <span className="ml-1 text-xs text-faint">(this deal)</span>}
                          </td>
                          <td className="py-2">{points(o.valuation.chasePoints)}</td>
                          <td className="py-2">{usd(o.deal.mandatoryCashUsd)}</td>
                          <td className="py-2">{cpp(o.valuation.practicalCpp ?? o.valuation.headlineCpp)}</td>
                          <td className="py-2 text-right">
                            {o.deal.id !== deal.id && (
                              <Link className="text-primary" href={`/positioning?a=${home ? o.deal.id : deal.id}&b=${home ? deal.id : o.deal.id}`}>
                                Compare
                              </Link>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </Card>
          )}

          <Card className="p-5">
            <SectionTitle>Guided booking</SectionTitle>
            <p className="mb-3 text-sm text-muted">Points &amp; Paradise never transfers points, books travel, takes payment or asks for loyalty passwords.</p>
            <BookingGuide dealId={deal.id} steps={steps} />
          </Card>
        </div>

        <aside className="space-y-6">
          <Card className="p-5">
            <SectionTitle>Actions</SectionTitle>
            <DealActions dealId={deal.id} saved={data.savedIds.has(deal.id)} isDemo={isDemo} archived={!!deal.archivedAt} editable={deal.sourceKind !== 'demo' && deal.sourceKind !== 'api'} watched={!!watch} />
            {watch && !watch.auto && <p className="mt-3 text-xs text-muted">No permitted data source can re-check this automatically. Use “I just confirmed it&apos;s available” after checking the official site.</p>}
          </Card>

          <Card className="p-5">
            <SectionTitle>Booking deadline</SectionTitle>
            <p className="font-semibold">{e.deadline.type === 'confirmed' && e.deadline.at ? <Countdown targetIso={e.deadline.at.toISOString()} nowMs={now.getTime()} /> : e.deadline.headline}</p>
            {e.deadline.type === 'confirmed' && e.deadline.at && <p className="text-sm">{dateTime(e.deadline.at, tz)}</p>}
            <p className="mt-2 text-sm text-muted">{e.deadline.detail}</p>
            <dl className="mt-3">
              <Row label="Deadline type" value={e.deadline.type} />
              <Row label="Confidence" value={e.deadline.confidence} />
              <Row label="Source" value={e.deadline.source ?? '—'} />
              <Row label="Last availability check" value={isDemo ? 'Never (demo)' : dateTime(deal.lastVerifiedAt, tz)} />
            </dl>
          </Card>

          <Card className="p-5">
            <SectionTitle>Evidence</SectionTitle>
            <dl>
              <Row label="Status" value={e.statusLabel} />
              <Row label="Bookable now?" value={isBookableStatus(e.status) ? 'At last check' : 'Not confirmed'} warn={!isBookableStatus(e.status)} />
              <Row label="Source" value={`${SOURCE_KIND_LABELS[deal.sourceKind]} · ${deal.sourceName}`} />
              <Row label="Collected" value={dateTime(deal.collectedAt, tz)} />
              <Row label="Last verified" value={isDemo ? 'Never (demo)' : deal.lastVerifiedAt ? `${dateTime(deal.lastVerifiedAt, tz)}${deal.verificationMethod ? ` · ${deal.verificationMethod.replace(/_/g, ' ')}` : ''}` : 'Not verified'} />
              <Row label="Availability risk" value={risk.label} />
              <Row label="Data confidence" value={v.confidence} />
            </dl>
            {deal.missingInfo.length > 0 && (
              <p className="mt-3 text-sm text-warn">Missing: {deal.missingInfo.join(', ')}</p>
            )}
            <div className="mt-3 space-y-1 text-sm">
              {deal.sourceUrl && (
                <p>
                  <ExternalLink href={deal.sourceUrl}>Original source</ExternalLink>
                </p>
              )}
              {partner?.programUrl && (
                <p>
                  <ExternalLink href={partner.programUrl}>{partner.programName} official site</ExternalLink>
                </p>
              )}
              <p>
                <ExternalLink href={CHASE_HOME_URL}>chase.com (Ultimate Rewards)</ExternalLink>
              </p>
            </div>
          </Card>

          <Card className="p-5">
            <SectionTitle>Outlook</SectionTitle>
            {prediction.reliable ? (
              <div className="space-y-2 text-sm">
                <Badge tone={prediction.urgency === 'high' ? 'warn' : 'neutral'}>Prediction · {prediction.confidence} confidence</Badge>
                <p>{prediction.explanation}</p>
              </div>
            ) : (
              <p className="text-sm text-muted">{prediction.reason}</p>
            )}
            {isDemo && <p className="mt-2 text-xs text-faint">Based on fictional demo observations.</p>}
          </Card>
        </aside>
      </div>
    </article>
  )
}
