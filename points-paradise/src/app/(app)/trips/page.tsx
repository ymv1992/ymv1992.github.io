import type { Metadata } from 'next'
import Link from 'next/link'
import { deleteTripAction } from '@/app/actions/trip-actions'
import { getDb } from '@/lib/db/client'
import { listTrips, tripDayCount } from '@/lib/data/trips'
import { dateRange, points, usd } from '@/lib/format'
import { requireUserId } from '@/lib/server/session'
import { Icon } from '@/components/icons'
import { ConfirmSubmit } from '@/components/trips/confirm-submit'
import { TripDetailsForm } from '@/components/trips/trip-details-form'
import { Badge, Card, EmptyState, PageHeader, SectionTitle } from '@/components/ui'

export const metadata: Metadata = { title: 'My Trips' }

export default async function TripsPage() {
  const userId = await requireUserId()
  const list = await listTrips(await getDb(), userId)

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Plan" title="My Trips" subtitle="Plan each day, keep ideas for later, drag things around and tick them off as you go." />
      {list.length === 0 ? (
        <EmptyState title="No trips yet">Start one below. You can add dates later, and add flights or hotels you&rsquo;ve saved.</EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2" aria-label="Your trips">
          {list.map((t) => {
            const days = tripDayCount(t)
            const pct = t.totals.items ? Math.round((t.totals.done / t.totals.items) * 100) : 0
            return (
              <li key={t.id} className="relative">
                <Link href={`/trips/${t.id}`} className="block h-full rounded-2xl border border-line bg-surface p-4 pb-12 hover:border-primary">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-display text-xl">{t.name}</p>
                      <p className="text-sm text-muted">
                        {[t.destination, t.startDate ? dateRange(t.startDate, t.endDate) : `${days} day${days === 1 ? '' : 's'} · someday`].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {t.shareToken && <Badge tone="primary">Shared</Badge>}
                      {t.watchId && <Badge tone="gold">Watching</Badge>}
                    </div>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                    <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mt-1.5 text-xs text-muted">
                    {t.totals.done} of {t.totals.items} done
                    {t.totals.points ? ` · ${points(t.totals.points)} pts` : ''}
                    {t.totals.cashUsd ? ` · ${usd(t.totals.cashUsd)}` : ''}
                  </p>
                </Link>
                {/* Outside the link, so tapping it never opens the trip. */}
                <form action={deleteTripAction.bind(null, t.id)} className="absolute right-3 bottom-3">
                  <ConfirmSubmit
                    message={`Delete "${t.name}" and everything in it? This can't be undone.`}
                    className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs text-danger hover:bg-danger-soft"
                    aria-label={`Delete ${t.name}`}
                  >
                    <Icon name="trash" className="size-3.5" /> Delete
                  </ConfirmSubmit>
                </form>
              </li>
            )
          })}
        </ul>
      )}
      <Card className="p-5">
        <SectionTitle>Start a trip</SectionTitle>
        <TripDetailsForm />
      </Card>
    </div>
  )
}
