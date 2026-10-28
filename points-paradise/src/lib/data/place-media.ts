import { and, eq, isNull, or, isNotNull } from 'drizzle-orm'
import type { AppDb } from '../db/client'
import { dataSources, placeLookups, tripItems, trips, type PlacePhoto } from '../db/schema'
import { expandShortMapsLink, isGoogleMapsLink, isShortMapsLink, parseGoogleMapsLink } from '../places/google-maps-link'
import { geocode } from '../providers/nominatim'
import { findPlacePhoto } from '../providers/wikimedia'
import { dayStart, logJob, requestsSince } from './usage'

export interface PlaceMedia {
  lat: number | null
  lng: number | null
  span: number | null
  /** The place's name when it came from a link (used when the item has no place yet). */
  name: string | null
  photo: PlacePhoto | null
}

export interface PlaceDeps {
  fetch: typeof fetch
  now: Date
  /** Gap kept between OpenStreetMap searches (its policy allows one a second). */
  minIntervalMs?: number
}

const CACHE_DAYS = 90
const DEFAULT_SPAN = 0.01
/** Self-imposed daily caps, well inside what the free services tolerate. */
const DAILY_CAP = { nominatim: 300, wikimedia: 1500 }

let nextSearchAt = 0

async function searchSlot(minIntervalMs: number) {
  const now = Date.now()
  const wait = nextSearchAt - now
  nextSearchAt = Math.max(now, nextSearchAt) + minIntervalMs
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
}

function cacheKey(url: string | null, place: string | null, destination: string): string {
  return `v1|${(url ?? '').trim()}|${(place ?? '').trim().toLowerCase()}|${destination.trim().toLowerCase()}`.slice(0, 1000)
}

async function enabled(db: AppDb, id: 'nominatim' | 'wikimedia', now: Date): Promise<boolean> {
  const [src] = await db.select({ enabled: dataSources.enabled }).from(dataSources).where(eq(dataSources.id, id))
  if (src && !src.enabled) return false
  return (await requestsSince(db, id, dayStart(now))) < DAILY_CAP[id]
}

/**
 * Finds where a place is and a photo of it: from a Google Maps link when
 * there is one, otherwise by searching OpenStreetMap for the place name near
 * the trip's destination. Results are cached for 90 days.
 */
export async function lookupPlace(db: AppDb, input: { url: string | null; place: string | null; destination: string }, deps: PlaceDeps): Promise<PlaceMedia | null> {
  const placeIsLink = !!input.place && isGoogleMapsLink(input.place)
  const link = input.url && isGoogleMapsLink(input.url) ? input.url : placeIsLink ? input.place : null
  const typed = input.place && !placeIsLink ? input.place.trim() : null
  if (!link && !typed) return null

  const key = cacheKey(link, typed, input.destination)
  const [cached] = await db.select().from(placeLookups).where(eq(placeLookups.key, key))
  if (cached && deps.now.getTime() - cached.fetchedAt.getTime() < CACHE_DAYS * 86_400_000) return cached.value as PlaceMedia

  const startedAt = new Date()
  let name: string | null = null
  let lat: number | null = null
  let lng: number | null = null
  let span: number | null = null
  let wikipedia: string | null = null
  let wikidata: string | null = null
  let searches = 0
  let photoRequests = 0
  try {
    if (link) {
      const full = isShortMapsLink(link) ? await expandShortMapsLink(link, deps.fetch) : link
      const info = full ? parseGoogleMapsLink(full) : null
      name = info?.name ?? null
      lat = info?.lat ?? null
      lng = info?.lng ?? null
    }
    const searchName = name ?? typed
    if ((lat == null || lng == null) && searchName && (await enabled(db, 'nominatim', deps.now))) {
      const dest = input.destination.trim()
      const queries = dest && !searchName.toLowerCase().includes(dest.toLowerCase()) ? [`${searchName}, ${dest}`, searchName] : [searchName]
      for (const q of queries) {
        await searchSlot(deps.minIntervalMs ?? 1100)
        searches++
        const hit = await geocode(q, deps.fetch)
        if (!hit) continue
        lat = hit.lat
        lng = hit.lng
        span = hit.span
        wikipedia = hit.wikipedia
        wikidata = hit.wikidata
        break
      }
    }
    let photo: PlacePhoto | null = null
    if (lat != null && lng != null && (await enabled(db, 'wikimedia', deps.now))) {
      const r = await findPlacePhoto({ name: searchName, lat, lng, wikipedia, wikidata }, deps.fetch)
      photo = r.photo
      photoRequests = r.requests
    }
    const media: PlaceMedia = { lat, lng, span: span == null ? null : Math.min(2, Math.max(DEFAULT_SPAN / 2, span)), name, photo }
    await db
      .insert(placeLookups)
      .values({ key, value: media, fetchedAt: deps.now })
      .onConflictDoUpdate({ target: placeLookups.key, set: { value: media, fetchedAt: deps.now } })
    if (searches) await logJob(db, { provider: 'nominatim', jobType: 'place_lookup', params: { query: searchName, found: lat != null }, status: 'succeeded', startedAt, requestCount: searches, resultsCount: lat != null ? 1 : 0 })
    if (photoRequests) await logJob(db, { provider: 'wikimedia', jobType: 'place_photo', params: { query: searchName, found: !!photo }, status: 'succeeded', startedAt, requestCount: photoRequests, resultsCount: photo ? 1 : 0 })
    return media
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Place lookup failed'
    await logJob(db, { provider: searches ? 'nominatim' : 'wikimedia', jobType: 'place_lookup', params: { query: name ?? typed }, status: 'failed', startedAt, requestCount: searches + photoRequests, error: message })
    return null
  }
}

/** Looks up the map position and photo for one trip item and saves them. Never throws. */
export async function enrichTripItem(db: AppDb, userId: string, itemId: string, deps: PlaceDeps): Promise<{ map: boolean; photo: boolean }> {
  const [row] = await db
    .select({ item: tripItems, destination: trips.destination })
    .from(tripItems)
    .innerJoin(trips, eq(trips.id, tripItems.tripId))
    .where(and(eq(tripItems.id, itemId), eq(trips.userId, userId)))
  if (!row) return { map: false, photo: false }
  let media: PlaceMedia | null = null
  try {
    media = await lookupPlace(db, { url: row.item.url, place: row.item.place, destination: row.destination }, deps)
  } catch {
    media = null
  }
  const placeIsLink = !!row.item.place && isGoogleMapsLink(row.item.place)
  await db
    .update(tripItems)
    .set({
      lat: media?.lat ?? null,
      lng: media?.lng ?? null,
      mapSpan: media?.span ?? null,
      photo: media?.photo ?? null,
      mediaCheckedAt: deps.now,
      // A Google Maps link pasted as the place becomes the link, and its name the place.
      ...(placeIsLink ? { url: row.item.url ?? row.item.place, place: media?.name ?? null } : !row.item.place && media?.name ? { place: media.name } : {}),
    })
    .where(eq(tripItems.id, itemId))
  return { map: media?.lat != null, photo: !!media?.photo }
}

/** Items in a trip that have a place or a link but were never looked up (for example, added before maps existed). */
export async function itemsNeedingMedia(db: AppDb, userId: string, tripId: string) {
  return db
    .select({ id: tripItems.id })
    .from(tripItems)
    .innerJoin(trips, eq(trips.id, tripItems.tripId))
    .where(and(eq(trips.id, tripId), eq(trips.userId, userId), isNull(tripItems.mediaCheckedAt), or(isNotNull(tripItems.place), isNotNull(tripItems.url))))
}
