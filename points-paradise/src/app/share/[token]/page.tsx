import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getDb } from '@/lib/db/client'
import { getSharedTrip, tripDayCount, tripDayDate, tripTotals } from '@/lib/data/trips'
import { dateRange, points, usd } from '@/lib/format'
import { TRIP_KIND_LABEL, dayHeading, mapsUrl, type TripDayView } from '@/lib/trips/shared'
import { Icon } from '@/components/icons'
import { Card, buttonClass } from '@/components/ui'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Shared trip', robots: { index: false, follow: false }, referrer: 'no-referrer' }

/** Read-only itinerary for whoever has the share link. Shows only this trip, nothing else from the owner's account. */
export default async function SharedTripPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const data = await getSharedTrip(await getDb(), token)
  if (!data) notFound()
  const { trip, items } = data
  const days: TripDayView[] = Array.from({ length: tripDayCount(trip) }, (_, i) => ({ day: i + 1, date: tripDayDate(trip, i + 1) }))
  const totals = tripTotals(items)
  const sections = [...days.map((d) => ({ key: `d${d.day}`, title: dayHeading(d), list: items.filter((i) => i.day === d.day) })), { key: 'ideas', title: 'Ideas', list: items.filter((i) => i.day == null) }].filter(
    (s) => s.key !== 'ideas' || s.list.length > 0,
  )

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <p className="text-xs font-semibold tracking-[0.2em] text-gold uppercase">Shared itinerary</p>
      <h1 className="font-display text-4xl">{trip.name}</h1>
      <p className="mt-1 text-muted">{[trip.destination, trip.startDate ? dateRange(trip.startDate, trip.endDate) : `${days.length} days · dates not set`].filter(Boolean).join(' · ')}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <a href={`/share/${token}/pdf`} className={buttonClass('primary', 'sm')} download>
          <Icon name="download" className="size-4" /> Download PDF
        </a>
        <span className="text-sm text-muted">
          {totals.done} of {totals.items} done
          {totals.points ? ` · ${points(totals.points)} Chase pts` : ''}
          {totals.cashUsd ? ` · ${usd(totals.cashUsd)}` : ''}
        </span>
      </div>
      {trip.notes && <p className="mt-4 text-sm whitespace-pre-line">{trip.notes}</p>}
      <div className="mt-6 space-y-4">
        {sections.map((s) => (
          <Card key={s.key} className="p-4">
            <h2 className="font-display text-lg">{s.title}</h2>
            {s.list.length === 0 ? (
              <p className="mt-1 text-sm text-muted">Nothing planned yet.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {s.list.map((i) => (
                  <li key={i.id} className="flex items-start gap-3 rounded-xl border border-line bg-bg p-2.5">
                    <span
                      aria-label={i.done ? 'Done' : 'Not done yet'}
                      className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border ${i.done ? 'border-primary bg-primary text-primary-ink' : 'border-line'}`}
                    >
                      {i.done && <Icon name="check" className="size-3.5" strokeWidth={3} />}
                    </span>
                    <div className="min-w-0 flex-1 text-sm">
                      <p className={i.done ? 'text-muted line-through' : ''}>
                        {i.time && <span className="tabular mr-1.5 text-muted">{i.time}</span>}
                        <span className="font-semibold">{i.title}</span>
                      </p>
                      <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted">
                        <span>
                          {[TRIP_KIND_LABEL[i.kind], i.points ? `${points(i.points)} pts` : null, i.costUsd ? usd(i.costUsd) : null].filter(Boolean).join(' · ')}
                        </span>
                        {i.place && (
                          <a href={mapsUrl(i.place, trip.destination)} target="_blank" rel="noopener noreferrer" className="text-primary">
                            {i.place} ↗
                          </a>
                        )}
                        {i.url && (
                          <a href={i.url} target="_blank" rel="noopener noreferrer nofollow" className="text-primary">
                            Link ↗
                          </a>
                        )}
                      </p>
                      {i.notes && <p className="mt-1 text-xs whitespace-pre-line">{i.notes}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>
      <p className="mt-8 text-center text-xs text-faint">Shared from Points &amp; Paradise. This page updates when the trip changes.</p>
    </main>
  )
}
