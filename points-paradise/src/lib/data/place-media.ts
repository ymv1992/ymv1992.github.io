import { and, eq, isNull, ne, or, isNotNull } from 'drizzle-orm'
import type { AppDb } from '../db/client'
import { dataSources, placeLookups, tripItems, trips, type PlacePhoto, type TripItemKind } from '../db/schema'
import { expandGoogleLink, isGooglePlaceLink, isGoogleShortLink, parseGoogleLink } from '../places/google-maps-link'
import { geocode, reverseCity, type CityResult } from '../providers/nominatim'
import { findPlacePhoto } from '../providers/wikimedia'
import { dayStart, logJob, requestsSince } from './usage'

export interface PlaceMedia {
  lat: number | null
  lng: number | null
  span: number | null
  /** The place's name, from a link or found from the item's title (used when the item has no place yet). */
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
/** "Nothing found" is only remembered briefly, so a fix or a new source gets a fresh try. */
const MISS_CACHE_HOURS = 24
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

function cacheKey(url: string | null, place: string | null, title: string | null, destination: string): string {
  return `v2|${(url ?? '').trim()}|${(place ?? '').trim().toLowerCase()}|${(title ?? '').toLowerCase()}|${destination.trim().toLowerCase()}`.slice(0, 1000)
}

/** An item title as a place search ("Capela das Almas"), or null when it can't be one. */
function titleQuery(title: string | null | undefined): string | null {
  const t = (title ?? '')
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
  return t.length >= 3 ? t.slice(0, 120) : null
}

async function enabled(db: AppDb, id: 'nominatim' | 'wikimedia', now: Date): Promise<boolean> {
  const [src] = await db.select({ enabled: dataSources.enabled }).from(dataSources).where(eq(dataSources.id, id))
  if (src && !src.enabled) return false
  return (await requestsSince(db, id, dayStart(now))) < DAILY_CAP[id]
}

export interface PlaceInput {
  url: string | null
  place: string | null
  /** The item's title, searched when there is no place and the link doesn't say where. */
  title?: string | null
  kind?: TripItemKind
  destination: string
}

/**
 * Finds where a place is and a photo of it: from a Google link when there is
 * one (Maps links, or share.google / g.co links that lead to a named place),
 * otherwise by searching OpenStreetMap for the place, or the item's title,
 * near the trip's destination. Found places are cached for 90 days, misses
 * for a day.
 */
export async function lookupPlace(db: AppDb, input: PlaceInput, deps: PlaceDeps): Promise<PlaceMedia | null> {
  const placeIsLink = !!input.place && isGooglePlaceLink(input.place)
  const link = input.url && isGooglePlaceLink(input.url) ? input.url : placeIsLink ? input.place : null
  const typed = input.place && !placeIsLink && !/^https?:\/\//i.test(input.place.trim()) ? input.place.trim() : null
  const title = !typed && input.kind !== 'note' ? titleQuery(input.title) : null
  if (!link && !typed && !title) return null

  const key = cacheKey(link, typed, title, input.destination)
  const [cached] = await db.select().from(placeLookups).where(eq(placeLookups.key, key))
  if (cached) {
    const age = deps.now.getTime() - cached.fetchedAt.getTime()
    const hit = (cached.value as PlaceMedia).lat != null
    if (age < (hit ? CACHE_DAYS * 86_400_000 : MISS_CACHE_HOURS * 3_600_000)) return cached.value as PlaceMedia
  }

  const startedAt = new Date()
  let name: string | null = null
  let lat: number | null = null
  let lng: number | null = null
  let span: number | null = null
  let wikipedia: string | null = null
  let wikidata: string | null = null
  let foundName: string | null = null
  let searches = 0
  let photoRequests = 0
  try {
    if (link) {
      const short = isGoogleShortLink(link)
      const full = short ? await expandGoogleLink(link, deps.fetch) : link
      const info = full ? parseGoogleLink(full) : null
      name = info?.name ?? null
      lat = info?.lat ?? null
      lng = info?.lng ?? null
      // Recorded in Settings → Usage, so a link style the app can't read yet shows up.
      await logJob(db, {
        provider: 'google_links',
        jobType: 'place_link',
        params: { host: new URL(link).hostname, readable: !!info, found: info ? (info.lat != null ? 'position' : 'name') : 'nothing' },
        status: info ? 'succeeded' : 'failed',
        startedAt,
        requestCount: short ? 1 : 0,
        error: info ? undefined : 'Could not read a place from this link',
      })
    }
    const fromTitle = !name && !typed && !!title
    const searchName = name ?? typed ?? title
    if ((lat == null || lng == null) && searchName && (await enabled(db, 'nominatim', deps.now))) {
      const dest = input.destination.trim()
      const near = dest && !searchName.toLowerCase().includes(dest.toLowerCase()) ? `${searchName}, ${dest}` : searchName
      // A title is only searched near the destination (never worldwide), and also without any "(…)" aside.
      const bare = searchName.replace(/\s*\([^)]*\)\s*/g, ' ').trim()
      const queries = fromTitle ? [near, ...(bare && bare !== searchName ? [dest ? `${bare}, ${dest}` : bare] : [])] : near === searchName ? [searchName] : [near, searchName]
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
        foundName = hit.name
        break
      }
    }
    let photo: PlacePhoto | null = null
    if (lat != null && lng != null && (await enabled(db, 'wikimedia', deps.now))) {
      const r = await findPlacePhoto({ name: searchName, lat, lng, wikipedia, wikidata }, deps.fetch)
      photo = r.photo
      photoRequests = r.requests
    }
    const media: PlaceMedia = {
      lat,
      lng,
      span: span == null ? null : Math.min(2, Math.max(DEFAULT_SPAN / 2, span)),
      // When the title was searched, show the name of what was found, so a wrong pin is easy to spot.
      name: name ?? (fromTitle && lat != null ? foundName : null),
      photo,
    }
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

/**
 * The town or city at a point, cached by position (about 1 km) for 90 days.
 * Null when OpenStreetMap is off, over its daily cap, or doesn't know.
 */
export async function cityAt(db: AppDb, lat: number, lng: number, deps: PlaceDeps): Promise<CityResult | null> {
  const key = `city|${lat.toFixed(2)}|${lng.toFixed(2)}`
  const [cached] = await db.select().from(placeLookups).where(eq(placeLookups.key, key))
  if (cached) {
    const v = cached.value as CityResult | null
    const fresh = deps.now.getTime() - cached.fetchedAt.getTime() < (v ? CACHE_DAYS * 24 : MISS_CACHE_HOURS) * 3_600_000
    if (fresh) return v
  }
  if (!(await enabled(db, 'nominatim', deps.now))) return null
  const startedAt = new Date()
  try {
    await searchSlot(deps.minIntervalMs ?? 1100)
    const found = await reverseCity(lat, lng, deps.fetch)
    await logJob(db, { provider: 'nominatim', jobType: 'city_lookup', params: { lat: Number(lat.toFixed(2)), lng: Number(lng.toFixed(2)), found: !!found }, status: 'succeeded', startedAt, requestCount: 1, resultsCount: found ? 1 : 0 })
    await db
      .insert(placeLookups)
      .values({ key, value: found, fetchedAt: deps.now })
      .onConflictDoUpdate({ target: placeLookups.key, set: { value: found, fetchedAt: deps.now } })
    return found
  } catch (err) {
    await logJob(db, { provider: 'nominatim', jobType: 'city_lookup', params: { lat: Number(lat.toFixed(2)), lng: Number(lng.toFixed(2)) }, status: 'failed', startedAt, requestCount: 1, error: err instanceof Error ? err.message : 'City lookup failed' })
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
    media = await lookupPlace(db, { url: row.item.url, place: row.item.place, title: row.item.title, kind: row.item.kind, destination: row.destination }, deps)
  } catch {
    media = null
  }
  const placeIsLink = !!row.item.place && isGooglePlaceLink(row.item.place)
  // Which town or city it's in, for the trip's map and weather by city. Big areas (a whole island or country) have none.
  const small = media?.lat != null && media.lng != null && (media.span ?? 0) < 0.5
  const city = small ? await cityAt(db, media!.lat!, media!.lng!, deps).catch(() => null) : null
  await db
    .update(tripItems)
    .set({
      lat: media?.lat ?? null,
      lng: media?.lng ?? null,
      mapSpan: media?.span ?? null,
      photo: media?.photo ?? null,
      mediaCheckedAt: deps.now,
      city: city?.city ?? null,
      countryCode: city?.countryCode ?? null,
      cityCheckedAt: deps.now,
      // A Google link pasted as the place becomes the link, and its name the place.
      ...(placeIsLink ? { url: row.item.url ?? row.item.place, place: media?.name ?? null } : !row.item.place && media?.name ? { place: media.name } : {}),
    })
    .where(eq(tripItems.id, itemId))
  return { map: media?.lat != null, photo: !!media?.photo }
}

/**
 * Items in a trip not looked up yet (for example, added before maps existed),
 * or with a map but no city yet (added before cities existed). Notes count
 * only with a place or link.
 */
export async function itemsNeedingMedia(db: AppDb, userId: string, tripId: string) {
  return db
    .select({ id: tripItems.id })
    .from(tripItems)
    .innerJoin(trips, eq(trips.id, tripItems.tripId))
    .where(
      and(
        eq(trips.id, tripId),
        eq(trips.userId, userId),
        or(and(isNull(tripItems.mediaCheckedAt), or(ne(tripItems.kind, 'note'), isNotNull(tripItems.place), isNotNull(tripItems.url))), and(isNotNull(tripItems.lat), isNull(tripItems.cityCheckedAt))),
      ),
    )
}
