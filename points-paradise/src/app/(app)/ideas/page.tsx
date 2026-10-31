import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { getDb } from '@/lib/db/client'
import { ideaDeck, listTikToks } from '@/lib/data/ideas'
import { planTrip } from '@/lib/data/trip-insights'
import { getTrip, listTrips } from '@/lib/data/trips'
import { findTikTokLink } from '@/lib/providers/tiktok'
import { WIKIVOYAGE_LICENSE } from '@/lib/providers/wikivoyage'
import { requireUserId } from '@/lib/server/session'
import { IdeaDeck } from '@/components/ideas/idea-deck'
import { TikTokSaver, type SavedTikTok } from '@/components/ideas/tiktok-saver'
import { Card, EmptyState, PageHeader, SectionTitle, buttonClass } from '@/components/ui'

export const metadata: Metadata = { title: 'Ideas' }
// Saving a TikTok looks up its place, and a city's guide loads on first view.
export const maxDuration = 60

type Search = { trip?: string; city?: string; url?: string; text?: string; title?: string }

async function DeckSection({ userId, tripId, tripName, city, countryCode }: { userId: string; tripId: string; tripName: string; city: string; countryCode: string | null }) {
  const deck = await ideaDeck(await getDb(), userId, tripId, city, { fetch, now: new Date() })
  if (!deck) return null
  if (!deck.guide) return <p className="text-sm text-muted">The travel guide couldn&rsquo;t be loaded right now. Try again in a little while.</p>
  if (!deck.guide.title) return <p className="text-sm text-muted">Wikivoyage doesn&rsquo;t have a guide for {city} yet. Save TikToks above, or add ideas on the trip page.</p>
  return (
    <div>
      <IdeaDeck key={`${city}-${deck.remaining}`} tripId={tripId} tripName={tripName} city={city} countryCode={countryCode} cards={deck.cards} remaining={deck.remaining} skipped={deck.skipped} />
      <p className="mt-4 text-center text-[11px] text-faint">
        Ideas from{' '}
        <a href={deck.guide.url!} target="_blank" rel="noopener noreferrer" className="underline">
          Wikivoyage&rsquo;s {deck.guide.title} guide
        </a>{' '}
        ({WIKIVOYAGE_LICENSE}, shortened); photos from Wikimedia Commons, credited on each photo.
      </p>
    </div>
  )
}

export default async function IdeasPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams
  const userId = await requireUserId()
  const db = await getDb()
  const today = new Date().toISOString().slice(0, 10)
  const all = await listTrips(db, userId)
  // Coming trips first (soonest first), then someday trips, then past ones.
  const rank = (t: (typeof all)[number]) => (t.endDate && t.endDate < today ? 2 : t.startDate ? 0 : 1)
  const trips = [...all].sort((a, b) => rank(a) - rank(b) || (a.startDate ?? '').localeCompare(b.startDate ?? ''))
  const shared = sp.url && findTikTokLink(sp.url) ? sp.url : (findTikTokLink(`${sp.text ?? ''} ${sp.title ?? ''}`) ?? '')

  if (!trips.length) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Plan" title="Ideas" subtitle="Things to do in the places you're going." />
        <EmptyState title="Start a trip first">
          Ideas are for the places you plan to go.{' '}
          <Link href="/trips" className="text-primary">
            Make a trip
          </Link>{' '}
          and come back.
        </EmptyState>
      </div>
    )
  }

  const trip = trips.find((t) => t.id === sp.trip) ?? trips[0]!
  const data = (await getTrip(db, userId, trip.id))!
  const plan = planTrip(data.trip, data.items)
  const cities: { name: string; countryCode: string | null }[] = []
  for (const c of plan.cities) if (!cities.some((x) => x.name.toLowerCase() === c.city.toLowerCase())) cities.push({ name: c.city, countryCode: c.countryCode })
  const fallback = trip.destination.split(',')[0]?.trim()
  if (!cities.length && fallback) cities.push({ name: fallback, countryCode: null })
  const city = cities.find((c) => c.name.toLowerCase() === sp.city?.toLowerCase()) ?? cities[0] ?? null
  const tiktoks: SavedTikTok[] = (await listTikToks(db, userId, trip.id)).map((s) => ({
    id: s.id,
    status: s.status,
    title: s.data.title,
    found: s.data.lat != null,
    caption: s.data.caption ?? null,
    author: s.data.sourceTitle,
    authorUrl: s.data.sourceUrl,
    url: s.data.url,
    videoId: s.data.videoId ?? null,
    candidates: s.data.candidates ?? [],
  }))
  const href = (q: Record<string, string>) => `/ideas?${new URLSearchParams(q)}`

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Plan" title="Ideas" subtitle="Save places from TikTok, or swipe through things to do in the places you're going. What you like lands in your trip's Ideas." />

      {trips.length > 1 && (
        <nav aria-label="Trip" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {trips.map((t) => (
            <Link
              key={t.id}
              href={href({ trip: t.id })}
              aria-current={t.id === trip.id ? 'page' : undefined}
              className={`shrink-0 rounded-xl border px-3 py-1.5 text-sm ${t.id === trip.id ? 'border-primary bg-primary text-primary-ink' : 'border-line bg-surface hover:bg-surface-2'}`}
            >
              <span className="font-semibold">{t.name}</span>
              {t.destination && <span className={`block text-xs ${t.id === trip.id ? 'opacity-90' : 'text-muted'}`}>{t.destination}</span>}
            </Link>
          ))}
        </nav>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <SectionTitle>Save from TikTok</SectionTitle>
          <TikTokSaver tripId={trip.id} tripName={trip.name} shared={shared} saved={tiktoks} />
        </Card>

        <Card className="p-5">
          <SectionTitle aside={<Link href={`/trips/${trip.id}`} className={buttonClass('ghost', 'sm')}>Open trip</Link>}>{city ? `Things to do in ${city.name}` : 'Things to do'}</SectionTitle>
          {cities.length > 1 && (
            <nav aria-label="City" className="-mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1">
              {cities.map((c) => (
                <Link
                  key={c.name}
                  href={href({ trip: trip.id, city: c.name })}
                  aria-current={c.name === city?.name ? 'page' : undefined}
                  className={`shrink-0 rounded-full border px-3 py-1 text-sm ${c.name === city?.name ? 'border-primary bg-primary text-primary-ink' : 'border-line bg-surface hover:bg-surface-2'}`}
                >
                  {c.name}
                </Link>
              ))}
            </nav>
          )}
          {city ? (
            <Suspense fallback={<p className="text-sm text-muted">Opening the {city.name} travel guide…</p>}>
              <DeckSection userId={userId} tripId={trip.id} tripName={trip.name} city={city.name} countryCode={city.countryCode} />
            </Suspense>
          ) : (
            <p className="text-sm text-muted">
              Add where you&rsquo;re going to{' '}
              <Link href={`/trips/${trip.id}`} className="text-primary">
                the trip
              </Link>{' '}
              (or add a few places) to see ideas.
            </p>
          )}
        </Card>
      </div>
    </div>
  )
}
