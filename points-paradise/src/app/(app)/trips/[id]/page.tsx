import type { Metadata } from 'next'
import { headers } from 'next/headers'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { eq, inArray } from 'drizzle-orm'
import { addDealToTripAction, deleteTripAction, unwatchTripAction, watchTripAction } from '@/app/actions/trip-actions'
import { getDb } from '@/lib/db/client'
import { deals, watchlists } from '@/lib/db/schema'
import { loadAccount } from '@/lib/data/account'
import { evaluateMany } from '@/lib/data/evaluation'
import { itemsNeedingMedia } from '@/lib/data/place-media'
import { tripCurrenciesInUse } from '@/lib/data/trip-rates'
import { listSaved } from '@/lib/data/saved'
import { dealsForTrip, getTrip, tripDayCount, tripDayDate, tripTotals, tripWatchWindow } from '@/lib/data/trips'
import { CABINS, CABIN_LABELS } from '@/lib/domain/constants'
import { dateLabel, dateRange, points, usd } from '@/lib/format'
import { integrationStatus } from '@/lib/server/config'
import { requireUserId } from '@/lib/server/session'
import { formatMoney } from '@/lib/trips/money'
import { toItemView, type TripDayView } from '@/lib/trips/shared'
import { ActionForm } from '@/components/action-form'
import { Icon } from '@/components/icons'
import { ConfirmSubmit } from '@/components/trips/confirm-submit'
import { FindMediaButton } from '@/components/trips/find-media-button'
import { RatesCard } from '@/components/trips/rates-card'
import { ShareCard } from '@/components/trips/share-card'
import { TripBoard } from '@/components/trips/trip-board'
import { TripDetailsForm } from '@/components/trips/trip-details-form'
import { Badge, Card, Notice, PageHeader, SectionTitle, Stat, buttonClass } from '@/components/ui'

export const metadata: Metadata = { title: 'Trip' }
// Saving an item looks up its map and photo, which can take a few seconds.
export const maxDuration = 60

/** Changes whenever the trip's items do, so the board resets to what was saved. */
function boardVersion(items: { id: string; day: number | null; position: number; done: boolean; updatedAt: Date }[]): string {
  let h = 5381
  for (const i of items) for (const ch of `${i.id}${i.day}${i.position}${i.done}${i.updatedAt.getTime()}`) h = ((h << 5) + h + ch.charCodeAt(0)) | 0
  return `${items.length}-${h >>> 0}`
}

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId()
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const db = await getDb()
  const data = await getTrip(db, userId, id)
  if (!data) notFound()
  const { trip, items } = data
  const { wallet, profile } = await loadAccount(db, userId)
  const today = new Date().toISOString().slice(0, 10)
  const days: TripDayView[] = Array.from({ length: tripDayCount(trip) }, (_, i) => ({ day: i + 1, date: tripDayDate(trip, i + 1) }))
  const totals = tripTotals(items, trip.rates)
  const currencies = await tripCurrenciesInUse(db, trip)
  const unconverted = Object.entries(totals.unconverted).map(([c, a]) => formatMoney(a, c))
  const h = await headers()
  const origin = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'}`

  // Saved deals that can be added, and award flights already found for this trip.
  const saved = await listSaved(db, userId)
  const inTrip = new Set(items.map((i) => i.dealId).filter(Boolean))
  const savedDeals = saved.length
    ? (await db.select({ id: deals.id, title: deals.title, travelStart: deals.travelStart, sourceKind: deals.sourceKind }).from(deals).where(inArray(deals.id, saved.map((s) => s.dealId)))).filter(
        (d) => d.sourceKind !== 'demo' && !inTrip.has(d.id),
      )
    : []
  const fitting = (await dealsForTrip(db, trip, today)).filter((d) => !inTrip.has(d.id))
  const fittingValues = await evaluateMany(db, userId, fitting.map((d) => d.id))
  const [watch] = trip.watchId ? await db.select().from(watchlists).where(eq(watchlists.id, trip.watchId)) : []
  const watchWindow = tripWatchWindow(trip, today)
  const short = totals.points > wallet.chaseBalance ? totals.points - wallet.chaseBalance : 0
  const needMedia = (await itemsNeedingMedia(db, userId, trip.id)).length

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="My Trips"
        title={trip.name}
        subtitle={[trip.destination, trip.startDate ? dateRange(trip.startDate, trip.endDate) : `${days.length} days · dates not set`].filter(Boolean).join(' · ')}
        actions={
          <>
            <a href={`/trips/${trip.id}/pdf`} className={buttonClass('secondary', 'sm')} download>
              <Icon name="download" className="size-4" /> Download PDF
            </a>
            <form action={deleteTripAction.bind(null, trip.id)}>
              <ConfirmSubmit message={`Delete "${trip.name}" and everything in it? This can't be undone.`} className={buttonClass('danger', 'sm')}>
                <Icon name="trash" className="size-4" /> Delete trip
              </ConfirmSubmit>
            </form>
          </>
        }
      />
      <p className="-mt-3 text-sm">
        <Link href="/trips" className="text-primary">
          ← All trips
        </Link>
      </p>

      <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
        <Stat label="Planned" value={totals.items} />
        <Stat label="Done" value={`${totals.done} of ${totals.items}`} />
        <Stat
          label="Points used"
          value={totals.points ? points(totals.points) : '—'}
          hint={totals.points ? (short ? <span className="text-warn">{points(short)} more than your balance</span> : `You have ${points(wallet.chaseBalance)}`) : 'Tick “I booked this with points” on an item to count it'}
        />
        <Stat
          label="Cash"
          value={totals.cashUsd ? usd(totals.cashUsd) : '—'}
          hint={unconverted.length ? <span className="text-warn">Plus {unconverted.join(', ')} with no rate yet</span> : currencies.length ? 'In dollars, at your trip’s locked rates' : undefined}
        />
      </Card>

      {needMedia > 0 && <FindMediaButton tripId={trip.id} count={needMedia} />}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <TripBoard
          key={boardVersion(items)}
          tripId={trip.id}
          destination={trip.destination}
          currency={trip.currency}
          rates={trip.rates}
          days={days}
          items={items.map(toItemView)}
          today={today}
        />

        <div className="space-y-5">
          {currencies.length > 0 && (
            <Card className="p-4">
              <SectionTitle>Exchange rates</SectionTitle>
              <RatesCard tripId={trip.id} currencies={currencies} rates={trip.rates} />
            </Card>
          )}

          <Card className="p-4">
            <SectionTitle aside={<Icon name="share" className="size-4 text-muted" />}>Share with a partner</SectionTitle>
            <ShareCard tripId={trip.id} initialToken={trip.shareToken} origin={origin} />
          </Card>

          <Card className="p-4">
            <SectionTitle aside={<Icon name="bell" className="size-4 text-muted" />}>Watch for deals</SectionTitle>
            {!trip.destAirport ? (
              <p className="text-sm text-muted">Add the airport you&rsquo;d fly into (for example OGG for Maui) under Trip details below, and the site can watch for award flights for this trip.</p>
            ) : watch ? (
              <div className="space-y-2 text-sm">
                <p>
                  <Badge tone="gold">Watching</Badge> Award flights from {watch.origins.join(', ')} to {trip.destAirport}
                  {watch.cabin ? ` in ${CABIN_LABELS[watch.cabin as keyof typeof CABIN_LABELS].toLowerCase()}` : ''}, {dateLabel(watch.dateFrom)} – {dateLabel(watch.dateTo)}.
                </p>
                <p className="text-xs text-muted">
                  {watch.autoCheckSupported
                    ? `Checked about once a day${watch.lastCheckedAt ? `; last checked ${dateLabel(watch.lastCheckedAt.toISOString().slice(0, 10))}` : ''}. New award space shows up in Alerts.`
                    : 'Saved as a reminder. Add your seats.aero key so it can be checked automatically.'}
                </p>
                <form action={unwatchTripAction.bind(null, trip.id)}>
                  <button type="submit" className="text-sm text-primary underline-offset-2 hover:underline">
                    Stop watching
                  </button>
                </form>
              </div>
            ) : (
              <ActionForm action={watchTripAction} submitLabel="Watch for deals" className="space-y-3 text-sm">
                <input type="hidden" name="tripId" value={trip.id} />
                <p className="text-muted">
                  Checks seats.aero about once a day for award flights to {trip.destAirport}{' '}
                  {trip.startDate ? `around ${dateLabel(trip.startDate)} (${dateLabel(watchWindow.dateFrom)} – ${dateLabel(watchWindow.dateTo)})` : 'over the coming year'}, and alerts you when space shows up.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label htmlFor="w-origins" className="label">
                      From
                    </label>
                    <input id="w-origins" name="origins" defaultValue={profile.homeAirports.join(', ')} className="field uppercase" />
                  </div>
                  <div>
                    <label htmlFor="w-cabin" className="label">
                      Cabin
                    </label>
                    <select id="w-cabin" name="cabin" defaultValue="business" className="field">
                      {CABINS.map((c) => (
                        <option key={c} value={c}>
                          {CABIN_LABELS[c]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {!integrationStatus().seatsAero && <Notice tone="warn">Without a seats.aero key, the watch is saved as a reminder only.</Notice>}
              </ActionForm>
            )}
            {fitting.length > 0 && (
              <div className="mt-4 border-t border-line pt-3">
                <p className="mb-2 text-xs font-semibold tracking-wider text-faint uppercase">Award flights found for this trip</p>
                <ul className="space-y-2">
                  {fitting.map((d) => {
                    const e = fittingValues.get(d.id)
                    if (!e) return null
                    return (
                      <li key={d.id} className="rounded-xl border border-line p-2.5 text-sm">
                        <Link href={`/deals/${d.id}`} className="font-semibold hover:text-primary">
                          {e.deal.originAirport} → {e.deal.destination.airport} · {dateLabel(e.deal.travelStart)}
                        </Link>
                        <p className="text-xs text-muted">
                          {e.valuation.chasePoints ? `${points(e.valuation.chasePoints)} Chase pts` : `${points(e.deal.programPoints)} miles`}
                          {e.deal.flight ? ` · ${CABIN_LABELS[e.deal.flight.cabin]}` : ''} · {e.deal.providerName}
                        </p>
                        <ActionForm action={addDealToTripAction} submitLabel="Add to trip" className="mt-2 flex flex-wrap items-center gap-2">
                          <input type="hidden" name="tripId" value={trip.id} />
                          <input type="hidden" name="dealId" value={d.id} />
                        </ActionForm>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </Card>

          {savedDeals.length > 0 && (
            <Card className="p-4">
              <SectionTitle aside={<Icon name="bookmark" className="size-4 text-muted" />}>Add a saved deal</SectionTitle>
              <ActionForm action={addDealToTripAction} submitLabel="Add to trip" className="space-y-3 text-sm">
                <input type="hidden" name="tripId" value={trip.id} />
                <label htmlFor="saved-deal" className="sr-only">
                  Saved deal
                </label>
                <select id="saved-deal" name="dealId" className="field">
                  {savedDeals.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}
                      {d.travelStart ? ` (${dateLabel(d.travelStart)})` : ''}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted">It goes on its travel day if that&rsquo;s during the trip, otherwise into Ideas.</p>
              </ActionForm>
            </Card>
          )}

          <Card className="p-4">
            <details>
              <summary className="cursor-pointer font-display text-lg">Trip details</summary>
              <div className="mt-3">
                <TripDetailsForm
                  defaults={{
                    tripId: trip.id,
                    name: trip.name,
                    destination: trip.destination,
                    destAirport: trip.destAirport,
                    startDate: trip.startDate,
                    endDate: trip.endDate,
                    dayCount: trip.dayCount,
                    currency: trip.currency,
                    notes: trip.notes,
                  }}
                />
                <p className="mt-2 text-xs text-muted">Making a trip shorter moves anything on the removed days to Ideas.</p>
              </div>
            </details>
          </Card>
        </div>
      </div>
      {trip.notes && (
        <Card className="p-4 text-sm whitespace-pre-line">
          <SectionTitle>Notes</SectionTitle>
          {trip.notes}
        </Card>
      )}
    </div>
  )
}
