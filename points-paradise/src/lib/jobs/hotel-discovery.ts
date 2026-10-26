import { and, eq, isNull, like, lt, ne } from 'drizzle-orm'
import type { AppDb } from '../db/client'
import { appState, dataSources, deals } from '../db/schema'
import { loadAccount } from '../data/account'
import { upsertDeal } from '../data/deals'
import { dayStart, logJob, requestsSince } from '../data/usage'
import { hotelDiagnostics, hotelRowToDeals, hotelSearch, ROOMS_PROGRAMS, type HotelPlace, type HotelSearchRow } from '../providers/rooms-aero'

/**
 * Automatic hotel discovery through rooms.aero: award nights at Chase hotel
 * partners (Hyatt, Marriott, IHG, Wyndham) in popular places and the owner's
 * dream destinations. rooms.aero returns the cash rate for the same stay, so
 * these deals arrive with a value. Same key as seats.aero, separate quota.
 */

export const HOTEL_PLACES: HotelPlace[] = [
  { label: 'Tokyo, Japan', region: 'asia', tags: ['city', 'culture', 'food'] },
  { label: 'Kyoto, Japan', region: 'asia', tags: ['culture', 'scenic'] },
  { label: 'Osaka, Japan', region: 'asia', tags: ['city', 'food'] },
  { label: 'Seoul, South Korea', region: 'asia', tags: ['city', 'food'] },
  { label: 'Bali, Indonesia', region: 'asia', tags: ['beach', 'island', 'wellness', 'romantic'] },
  { label: 'Phuket, Thailand', region: 'asia', tags: ['beach', 'island'] },
  { label: 'Bangkok, Thailand', region: 'asia', tags: ['city', 'food'] },
  { label: 'Singapore', region: 'asia', tags: ['city', 'food'] },
  { label: 'Maldives', region: 'indian_ocean', tags: ['beach', 'island', 'overwater', 'romantic'] },
  { label: 'Maui, Hawaii', region: 'north_america', tags: ['beach', 'island', 'scenic'] },
  { label: 'Honolulu, Hawaii', region: 'north_america', tags: ['beach', 'city'] },
  { label: 'Kauai, Hawaii', region: 'north_america', tags: ['beach', 'island', 'scenic'] },
  { label: 'Kona, Hawaii', region: 'north_america', tags: ['beach', 'island', 'adventure'] },
  { label: 'Fiji', region: 'south_pacific', tags: ['beach', 'island'] },
  { label: 'Bora Bora, French Polynesia', region: 'south_pacific', tags: ['beach', 'island', 'overwater', 'romantic'] },
  { label: 'Sydney, Australia', region: 'oceania', tags: ['city', 'beach'] },
  { label: 'Queenstown, New Zealand', region: 'oceania', tags: ['mountains', 'adventure', 'scenic'] },
  { label: 'Paris, France', region: 'europe', tags: ['city', 'culture', 'romantic', 'food'] },
  { label: 'London, United Kingdom', region: 'europe', tags: ['city', 'culture'] },
  { label: 'Rome, Italy', region: 'europe', tags: ['culture', 'food'] },
  { label: 'Amalfi Coast, Italy', region: 'europe', tags: ['beach', 'scenic', 'romantic'] },
  { label: 'Lake Como, Italy', region: 'europe', tags: ['scenic', 'romantic'] },
  { label: 'Santorini, Greece', region: 'europe', tags: ['island', 'scenic', 'romantic'] },
  { label: 'Barcelona, Spain', region: 'europe', tags: ['city', 'beach', 'food'] },
  { label: 'Lisbon, Portugal', region: 'europe', tags: ['city', 'culture'] },
  { label: 'Zermatt, Switzerland', region: 'europe', tags: ['mountains', 'snow', 'scenic'] },
  { label: 'Reykjavik, Iceland', region: 'europe', tags: ['scenic', 'adventure'] },
  { label: 'Dubai, United Arab Emirates', region: 'middle_east', tags: ['city', 'desert'] },
  { label: 'Cape Town, South Africa', region: 'africa', tags: ['scenic', 'wildlife', 'food'] },
  { label: 'Cancun, Mexico', region: 'mexico_central_america', tags: ['beach'] },
  { label: 'Tulum, Mexico', region: 'mexico_central_america', tags: ['beach', 'wellness'] },
  { label: 'Los Cabos, Mexico', region: 'mexico_central_america', tags: ['beach', 'desert', 'scenic'] },
  { label: 'Puerto Vallarta, Mexico', region: 'mexico_central_america', tags: ['beach'] },
  { label: 'Guanacaste, Costa Rica', region: 'mexico_central_america', tags: ['beach', 'wildlife', 'adventure'] },
  { label: 'New York, New York', region: 'north_america', tags: ['city', 'food', 'culture'] },
  { label: 'Park City, Utah', region: 'north_america', tags: ['mountains', 'snow'] },
  { label: 'Sedona, Arizona', region: 'north_america', tags: ['desert', 'scenic', 'wellness'] },
]

export const HOTEL_METHOD = 'rooms.aero discovery'
export const HOTEL_DAILY_CAP = 60
/** rooms.aero calls always left for other uses. */
export const HOTEL_QUOTA_RESERVE = 100
/** Hotels kept per place each search, best value first. */
export const HOTELS_PER_PLACE = 6
/** A find not seen again in this long has dropped out of the results. */
const STALE_DAYS = 10
const AHEAD_DAYS = 330
const CURSOR_KEY = 'hotels:cursor'
const DAY = 86_400_000

export interface HotelDiscoveryOutcome {
  calls: number
  newDeals: number
  updatedDeals: number
  retired: number
  skipped: string[]
  errors: string[]
}

/** Dream destinations become extra places unless a listed place already covers them. */
export function hotelPlaces(dreams: readonly string[]): HotelPlace[] {
  const listed = HOTEL_PLACES.map((p) => p.label.toLowerCase())
  const extra: HotelPlace[] = []
  for (const raw of dreams) {
    const d = raw.trim()
    if (!d || d.length > 80) continue
    const key = d.toLowerCase()
    if (listed.some((l) => l.includes(key)) || extra.some((e) => e.label.toLowerCase() === key)) continue
    extra.push({ label: d, region: 'north_america', tags: [] })
  }
  return [...extra.slice(0, 6), ...HOTEL_PLACES]
}

/** Best value first (cents per point), then fewest points. */
export function pickHotels(rows: readonly HotelSearchRow[], keep = HOTELS_PER_PLACE): HotelSearchRow[] {
  return [...rows].sort((a, b) => (b.cpp ?? 0) - (a.cpp ?? 0) || (a.lowest_award_standard ?? Infinity) - (b.lowest_award_standard ?? Infinity)).slice(0, keep)
}

async function inBatches<T>(items: readonly T[], size: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn))
}

/** Runs the next slice of hotel searches, within the call limit, time budget, daily cap and quota reserve. */
export async function runHotelDiscovery(
  db: AppDb,
  userId: string,
  deps: { now: Date; apiKey: string | null; fetch: typeof fetch },
  limits: { maxCalls: number; timeBudgetMs: number },
): Promise<HotelDiscoveryOutcome> {
  const out: HotelDiscoveryOutcome = { calls: 0, newDeals: 0, updatedDeals: 0, retired: 0, skipped: [], errors: [] }
  const { now } = deps
  const account = await loadAccount(db, userId)
  if (!account.settings.discoveryEnabled || !account.settings.hotelDiscoveryEnabled) {
    out.skipped.push('Hotel discovery is turned off in Settings')
    return out
  }
  if (!deps.apiKey) {
    out.skipped.push('Hotel discovery: SEATS_AERO_API_KEY not set')
    return out
  }
  const [src] = await db.select().from(dataSources).where(eq(dataSources.id, 'rooms_aero'))
  if (src && !src.enabled) {
    out.skipped.push('rooms.aero disabled')
    return out
  }

  // Retire finds that have not come back in recent searches.
  const retired = await db
    .update(deals)
    .set({ availability: 'unavailable', archivedAt: now, archiveReason: 'availability_disappeared', updatedAt: now })
    .where(and(eq(deals.verificationMethod, HOTEL_METHOD), isNull(deals.archivedAt), lt(deals.lastSeenAt, new Date(now.getTime() - STALE_DAYS * DAY))))
    .returning({ id: deals.id })
  out.retired = retired.length

  const places = hotelPlaces(account.profile.dreamDestinations)
  const quota = src?.dailyQuota ?? 1000
  const usedToday = await requestsSince(db, 'rooms_aero', dayStart(now))
  const allowed = Math.min(limits.maxCalls, HOTEL_DAILY_CAP - usedToday, quota - HOTEL_QUOTA_RESERVE - usedToday, places.length)
  if (allowed <= 0) {
    out.skipped.push('Hotel discovery: daily limit reached')
    return out
  }
  const nights = Math.min(5, Math.max(1, account.profile.tripNightsMin ?? 3))
  const startDate = new Date(now.getTime() + DAY).toISOString().slice(0, 10)
  const endDate = new Date(now.getTime() + AHEAD_DAYS * DAY).toISOString().slice(0, 10)
  const sources = Object.values(ROOMS_PROGRAMS)

  const [cursorRow] = await db.select().from(appState).where(eq(appState.key, CURSOR_KEY))
  let cursor = Number((cursorRow?.value as { next?: number } | undefined)?.next ?? 0) % places.length
  const started = Date.now()

  for (let i = 0; i < allowed; i++) {
    if (Date.now() - started > limits.timeBudgetMs) break
    const place = places[cursor]!
    cursor = (cursor + 1) % places.length
    const startedAt = new Date()
    try {
      const res = await hotelSearch(deps.apiKey, { location: place.label, startDate, endDate, nights, sources }, deps.fetch)
      out.calls += res.requests
      const kept = pickHotels(res.rows).flatMap((row) => hotelRowToDeals(row, place, nights, HOTEL_METHOD))
      await inBatches(kept, 3, async (d) => {
        const { verifiedAt, ...cols } = d
        const up = await upsertDeal(db, cols, { now, verified: true, verifiedAt: verifiedAt ?? now, historySource: 'rooms_aero' })
        if (up.isNew) out.newDeals++
        else out.updatedDeals++
        // One current find per hotel and room type: retire this hotel's older dates.
        const prefix = d.sourceRef.split(':').slice(0, 2).join(':') + ':'
        const kind = d.sourceRef.split(':').at(-1)
        const older = await db
          .update(deals)
          .set({ archivedAt: now, archiveReason: 'availability_disappeared', availability: 'unavailable', updatedAt: now })
          .where(and(eq(deals.verificationMethod, HOTEL_METHOD), isNull(deals.archivedAt), like(deals.sourceRef, `${prefix}%:${kind}`), ne(deals.dedupeKey, d.dedupeKey)))
          .returning({ id: deals.id })
        out.retired += older.length
      })
      await logJob(db, {
        provider: 'rooms_aero',
        jobType: 'hotel_discovery',
        params: { place: place.label, startDate, endDate, nights, ...hotelDiagnostics(res), matched: kept.length },
        status: 'succeeded',
        startedAt,
        requestCount: res.requests,
        estimatedCostUsd: 0,
        resultsCount: kept.length,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Hotel search failed'
      out.calls += 1
      out.errors.push(`hotels ${place.label}: ${message}`)
      await logJob(db, { provider: 'rooms_aero', jobType: 'hotel_discovery', params: { place: place.label }, status: 'failed', startedAt, requestCount: 1, error: message })
      if (/\b(401|403)\b/.test(message)) break
    }
  }

  await db
    .insert(appState)
    .values({ key: CURSOR_KEY, value: { next: cursor } })
    .onConflictDoUpdate({ target: appState.key, set: { value: { next: cursor }, updatedAt: now } })
  return out
}

