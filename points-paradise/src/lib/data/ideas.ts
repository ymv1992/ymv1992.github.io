import { and, desc, eq } from 'drizzle-orm'
import type { AppDb } from '../db/client'
import { dataSources, placeLookups, tripItems, trips, tripSuggestions, type PlacePhoto, type TripSuggestionData } from '../db/schema'
import { expandTikTokLink, findTikTokLink, placesInCaption, tikTokInfo } from '../providers/tiktok'
import { commonsName, commonsPhotos } from '../providers/wikimedia'
import { findGuide, guidePages, guideUrl, parseListings, type GuideListing, type ListingType } from '../providers/wikivoyage'
import { enrichTripItem, lookupPlace, type PlaceDeps } from './place-media'
import { addTripItem } from './trips'
import { dayStart, logJob, requestsSince } from './usage'

export type GuideCard = GuideListing & { photo: PlacePhoto | null }

export interface CityGuide {
  city: string
  /** The Wikivoyage page, or null when there's no guide for this city. */
  title: string | null
  url: string | null
  listings: GuideCard[]
}

const GUIDE_DAYS = 30
const NO_GUIDE_HOURS = 24
const MAX_LISTINGS = 200
const MAX_PHOTOS = 100
/** Self-imposed daily caps, well inside what the free services allow. */
const DAILY_CAP = { wikivoyage: 300, tiktok: 200 }

async function allowed(db: AppDb, id: 'wikivoyage' | 'tiktok', now: Date): Promise<boolean> {
  const [src] = await db.select({ enabled: dataSources.enabled }).from(dataSources).where(eq(dataSources.id, id))
  if (src && !src.enabled) return false
  return (await requestsSince(db, id, dayStart(now))) < DAILY_CAP[id]
}

/**
 * A city's things to do from Wikivoyage, with photos from Wikimedia
 * Commons. Cached for 30 days (a city without a guide, for a day).
 */
export async function cityGuide(db: AppDb, city: string, deps: Pick<PlaceDeps, 'fetch' | 'now'>): Promise<CityGuide | null> {
  const key = `wv|v1|${city.trim().toLowerCase()}`
  const [hit] = await db.select().from(placeLookups).where(eq(placeLookups.key, key))
  if (hit) {
    const v = hit.value as CityGuide
    if (deps.now.getTime() - hit.fetchedAt.getTime() < (v.title ? GUIDE_DAYS * 24 : NO_GUIDE_HOURS) * 3_600_000) return v
  }
  if (!(await allowed(db, 'wikivoyage', deps.now))) return hit ? (hit.value as CityGuide) : null
  const startedAt = new Date()
  let requests = 0
  try {
    const found = await findGuide(city, deps.fetch)
    requests += found.requests
    let guide: CityGuide = { city, title: null, url: null, listings: [] }
    if (found.title) {
      const pages = await guidePages(found.title, deps.fetch)
      requests += pages.requests
      const byName = new Map<string, GuideListing>()
      for (const p of pages.pages) {
        for (const l of parseListings(p.text, p.title)) {
          const k = `${l.type}|${l.name.toLowerCase()}`
          const prev = byName.get(k)
          // The same place on the city page and a district page: keep the fuller entry.
          if (!prev || (l.content?.length ?? 0) > (prev.content?.length ?? 0)) byName.set(k, l)
        }
      }
      const listings = [...byName.values()].slice(0, MAX_LISTINGS)
      const files = listings.map((l) => l.image).filter((f): f is string => !!f).slice(0, MAX_PHOTOS)
      const photos = files.length ? await commonsPhotos(files, deps.fetch) : { photos: new Map<string, PlacePhoto>(), requests: 0 }
      if (photos.requests) await logJob(db, { provider: 'wikimedia', jobType: 'guide_photos', params: { city, files: files.length }, status: 'succeeded', startedAt, requestCount: photos.requests, resultsCount: photos.photos.size })
      guide = {
        city,
        title: found.title,
        url: guideUrl(found.title),
        listings: listings.map((l) => ({ ...l, photo: l.image ? (photos.photos.get(commonsName(l.image)) ?? null) : null })),
      }
    }
    await logJob(db, { provider: 'wikivoyage', jobType: 'city_guide', params: { city, page: guide.title }, status: 'succeeded', startedAt, requestCount: requests, resultsCount: guide.listings.length })
    await db.insert(placeLookups).values({ key, value: guide, fetchedAt: deps.now }).onConflictDoUpdate({ target: placeLookups.key, set: { value: guide, fetchedAt: deps.now } })
    return guide
  } catch (err) {
    await logJob(db, { provider: 'wikivoyage', jobType: 'city_guide', params: { city }, status: 'failed', startedAt, requestCount: Math.max(1, requests), error: err instanceof Error ? err.message : 'Guide failed' })
    return hit ? (hit.value as CityGuide) : null
  }
}

async function ownedTrip(db: AppDb, userId: string, tripId: string) {
  const [t] = await db.select().from(trips).where(and(eq(trips.id, tripId), eq(trips.userId, userId)))
  return t ?? null
}

const TYPE_ORDER: ListingType[] = ['see', 'do', 'eat', 'drink', 'buy']

/** Cards still to decide on: photos first, mixing sights, things to do, food and drink. */
export function orderDeck(cards: readonly GuideCard[], decided: ReadonlySet<string>, limit = 40): GuideCard[] {
  const open = cards.filter((c) => !decided.has(c.key))
  const queues = TYPE_ORDER.map((t) => [...open.filter((c) => c.type === t && c.photo), ...open.filter((c) => c.type === t && !c.photo && c.content)])
  const out: GuideCard[] = []
  while (out.length < limit && queues.some((q) => q.length)) for (const q of queues) if (q.length && out.length < limit) out.push(q.shift()!)
  return out
}

export interface IdeaDeck {
  guide: CityGuide | null
  cards: GuideCard[]
  remaining: number
  liked: number
  skipped: number
}

/** The next ideas for a city on a trip, leaving out ones already liked or skipped. */
export async function ideaDeck(db: AppDb, userId: string, tripId: string, city: string, deps: Pick<PlaceDeps, 'fetch' | 'now'>): Promise<IdeaDeck | null> {
  if (!(await ownedTrip(db, userId, tripId))) return null
  const guide = await cityGuide(db, city, deps)
  const rows = await db.select({ key: tripSuggestions.key, status: tripSuggestions.status }).from(tripSuggestions).where(and(eq(tripSuggestions.tripId, tripId), eq(tripSuggestions.source, 'wikivoyage')))
  const keys = new Set(guide?.listings.map((l) => l.key) ?? [])
  const mine = rows.filter((r) => keys.has(r.key))
  const decided = new Set(mine.map((r) => r.key))
  const cards = orderDeck(guide?.listings ?? [], decided)
  const open = (guide?.listings ?? []).filter((l) => !decided.has(l.key) && (l.photo || l.content)).length
  return { guide, cards, remaining: open, liked: mine.filter((r) => r.status === 'liked').length, skipped: mine.filter((r) => r.status === 'skipped').length }
}

function guideData(l: GuideCard, city: string, countryCode: string | null): TripSuggestionData {
  return {
    title: l.name,
    type: l.type,
    description: l.content,
    address: l.address,
    hours: l.hours,
    price: l.price,
    url: l.url,
    lat: l.lat,
    lng: l.lng,
    photo: l.photo,
    city,
    countryCode,
    sourceTitle: l.page,
    sourceUrl: guideUrl(l.page),
  }
}

async function record(db: AppDb, tripId: string, source: 'wikivoyage' | 'tiktok', key: string, status: 'new' | 'liked' | 'skipped', data: TripSuggestionData, itemId: string | null, now: Date) {
  await db
    .insert(tripSuggestions)
    .values({ tripId, source, key, status, data, itemId, updatedAt: now })
    .onConflictDoUpdate({ target: [tripSuggestions.tripId, tripSuggestions.source, tripSuggestions.key], set: { status, data, ...(itemId ? { itemId } : {}), updatedAt: now } })
}

const KIND: Record<string, 'activity' | 'food'> = { see: 'activity', do: 'activity', buy: 'activity', eat: 'food', drink: 'food' }

/** Adds a liked guide idea to the trip's Ideas list, with its place, link, description and photo. */
export async function likeGuideIdea(
  db: AppDb,
  userId: string,
  tripId: string,
  city: string,
  key: string,
  deps: Pick<PlaceDeps, 'fetch' | 'now'> & { countryCode?: string | null },
): Promise<{ ok: true; itemId: string; title: string } | { ok: false; error: string }> {
  if (!(await ownedTrip(db, userId, tripId))) return { ok: false, error: 'Trip not found' }
  const guide = await cityGuide(db, city, deps)
  const l = guide?.listings.find((x) => x.key === key)
  if (!l) return { ok: false, error: 'That idea is no longer in the guide. Reload the page.' }
  const credit = `From Wikivoyage’s ${l.page} guide (${'CC BY-SA 4.0'}).`
  const notes = [l.content, l.hours ? `Hours: ${l.hours}` : null, l.price ? `Price: ${l.price}` : null, credit].filter(Boolean).join('\n').slice(0, 1000)
  const r = await addTripItem(
    db,
    userId,
    tripId,
    {
      kind: KIND[l.type] ?? 'activity',
      title: l.name.slice(0, 120),
      day: null,
      time: null,
      place: [l.name, l.address].filter(Boolean).join(', ').slice(0, 200),
      url: l.url ?? guideUrl(l.page),
      costAmount: null,
      costCurrency: 'USD',
      points: null,
      notes,
    },
    deps.now,
  )
  if (!r.ok) return r
  if (l.lat != null && l.lng != null) {
    // The guide already knows where it is: no place search needed.
    await db
      .update(tripItems)
      .set({ lat: l.lat, lng: l.lng, mapSpan: 0.01, photo: l.photo, mediaCheckedAt: deps.now, city, countryCode: deps.countryCode ?? null, cityCheckedAt: deps.now })
      .where(eq(tripItems.id, r.id))
  }
  await record(db, tripId, 'wikivoyage', key, 'liked', guideData(l, city, deps.countryCode ?? null), r.id, deps.now)
  return { ok: true, itemId: r.id, title: l.name }
}

export async function skipGuideIdea(db: AppDb, userId: string, tripId: string, city: string, key: string, deps: Pick<PlaceDeps, 'fetch' | 'now'>): Promise<boolean> {
  if (!(await ownedTrip(db, userId, tripId))) return false
  const guide = await cityGuide(db, city, deps)
  const l = guide?.listings.find((x) => x.key === key)
  if (!l) return false
  await record(db, tripId, 'wikivoyage', key, 'skipped', guideData(l, city, null), null, deps.now)
  return true
}

/** Brings skipped guide ideas back into the deck. */
export async function unskipGuideIdeas(db: AppDb, userId: string, tripId: string): Promise<number> {
  if (!(await ownedTrip(db, userId, tripId))) return 0
  const rows = await db
    .delete(tripSuggestions)
    .where(and(eq(tripSuggestions.tripId, tripId), eq(tripSuggestions.source, 'wikivoyage'), eq(tripSuggestions.status, 'skipped')))
    .returning({ id: tripSuggestions.id })
  return rows.length
}

export type TikTokSaveResult = { ok: true; id: string; found: boolean; title: string } | { ok: false; error: string }

/**
 * Saves a TikTok to a trip: reads its caption and creator from TikTok's
 * embed info, finds the place it names near the trip's destination, and
 * waits for the owner to confirm before anything is added to the trip.
 */
export async function saveTikTok(db: AppDb, userId: string, tripId: string, text: string, deps: PlaceDeps): Promise<TikTokSaveResult> {
  const trip = await ownedTrip(db, userId, tripId)
  if (!trip) return { ok: false, error: 'Trip not found' }
  const link = findTikTokLink(text)
  if (!link) return { ok: false, error: 'Paste a TikTok link (it starts with https://www.tiktok.com or https://vm.tiktok.com).' }
  if (!(await allowed(db, 'tiktok', deps.now))) return { ok: false, error: 'TikTok saving is paused for today. Try again tomorrow.' }
  const startedAt = new Date()
  let video
  try {
    const full = await expandTikTokLink(link, deps.fetch)
    if (!full) {
      await logJob(db, { provider: 'tiktok', jobType: 'tiktok_save', params: { link: link.slice(0, 200) }, status: 'failed', startedAt, requestCount: 1, error: 'Could not open the short link' })
      return { ok: false, error: 'That TikTok link didn’t lead to a video. In TikTok, tap Share → Copy link and paste it again.' }
    }
    video = await tikTokInfo(full, deps.fetch)
    await logJob(db, { provider: 'tiktok', jobType: 'tiktok_save', params: { video: full.slice(0, 200), found: !!video }, status: 'succeeded', startedAt, requestCount: full === link ? 1 : 2, resultsCount: video ? 1 : 0 })
  } catch (err) {
    await logJob(db, { provider: 'tiktok', jobType: 'tiktok_save', params: { link: link.slice(0, 200) }, status: 'failed', startedAt, requestCount: 1, error: err instanceof Error ? err.message : 'TikTok failed' })
    return { ok: false, error: 'TikTok didn’t answer. Try again in a minute.' }
  }
  if (!video) return { ok: false, error: 'TikTok doesn’t share this video (it may be private or removed).' }

  const candidates = placesInCaption(video.caption)
  let place: Awaited<ReturnType<typeof lookupPlace>> = null
  let placeName: string | null = null
  for (const c of candidates.slice(0, 2)) {
    place = await lookupPlace(db, { url: null, place: c, destination: trip.destination, kind: 'activity' }, deps).catch(() => null)
    if (place?.lat != null) {
      placeName = c
      break
    }
  }
  const firstLine = video.caption.split('\n')[0]!.replace(/#\S+/g, '').trim()
  const data: TripSuggestionData = {
    title: placeName ?? (firstLine.slice(0, 120) || 'TikTok idea'),
    type: 'tiktok',
    description: null,
    address: null,
    hours: null,
    price: null,
    url: video.url,
    lat: place?.lat ?? null,
    lng: place?.lng ?? null,
    photo: place?.photo ?? null,
    city: null,
    countryCode: null,
    sourceTitle: video.author,
    sourceUrl: video.authorUrl,
    videoId: video.videoId,
    caption: video.caption,
    candidates,
  }
  await record(db, tripId, 'tiktok', video.videoId, 'new', data, null, deps.now)
  const [row] = await db
    .select({ id: tripSuggestions.id })
    .from(tripSuggestions)
    .where(and(eq(tripSuggestions.tripId, tripId), eq(tripSuggestions.source, 'tiktok'), eq(tripSuggestions.key, video.videoId)))
  return { ok: true, id: row!.id, found: !!placeName, title: data.title }
}

export async function listTikToks(db: AppDb, userId: string, tripId: string) {
  if (!(await ownedTrip(db, userId, tripId))) return []
  return db
    .select()
    .from(tripSuggestions)
    .where(and(eq(tripSuggestions.tripId, tripId), eq(tripSuggestions.source, 'tiktok')))
    .orderBy(desc(tripSuggestions.createdAt))
}

async function ownedSuggestion(db: AppDb, userId: string, id: string) {
  const [row] = await db
    .select({ s: tripSuggestions, trip: trips })
    .from(tripSuggestions)
    .innerJoin(trips, eq(trips.id, tripSuggestions.tripId))
    .where(and(eq(tripSuggestions.id, id), eq(trips.userId, userId)))
  return row ?? null
}

/** Adds a saved TikTok to the trip's Ideas, at the place the owner confirmed (or typed). */
export async function addTikTokIdea(db: AppDb, userId: string, suggestionId: string, placeText: string | null, deps: PlaceDeps): Promise<{ ok: true; itemId: string } | { ok: false; error: string }> {
  const found = await ownedSuggestion(db, userId, suggestionId)
  if (!found || found.s.source !== 'tiktok') return { ok: false, error: 'Not found' }
  const d = found.s.data
  const place = (placeText ?? '').trim().slice(0, 200) || (d.lat != null ? d.title : null)
  const by = d.sourceTitle ? ` by @${d.sourceTitle.replace(/^@/, '')}` : ''
  const r = await addTripItem(
    db,
    userId,
    found.trip.id,
    {
      kind: 'activity',
      title: (place ?? d.title).slice(0, 120),
      day: null,
      time: null,
      place,
      url: d.url,
      costAmount: null,
      costCurrency: 'USD',
      points: null,
      notes: [d.caption, `Saved from TikTok${by}.`].filter(Boolean).join('\n').slice(0, 1000),
    },
    deps.now,
  )
  if (!r.ok) return r
  // Finds the map, photo and city for the place (cached when it was found on saving).
  await enrichTripItem(db, userId, r.id, deps)
  await db.update(tripSuggestions).set({ status: 'liked', itemId: r.id, updatedAt: deps.now }).where(eq(tripSuggestions.id, suggestionId))
  return { ok: true, itemId: r.id }
}

export async function dismissTikTok(db: AppDb, userId: string, suggestionId: string, now = new Date()): Promise<void> {
  const found = await ownedSuggestion(db, userId, suggestionId)
  if (found?.s.source === 'tiktok') await db.update(tripSuggestions).set({ status: 'skipped', updatedAt: now }).where(eq(tripSuggestions.id, suggestionId))
}
