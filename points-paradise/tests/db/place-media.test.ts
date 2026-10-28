/** Maps and photos for trip items: from Google Maps links or place names, cached, and refreshed when the place changes (TEST FIXTURES). */
import { beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/client'
import { searchJobs, tripItems } from '@/lib/db/schema'
import { ensureOwnerAccount } from '@/lib/data/account'
import { enrichTripItem, itemsNeedingMedia } from '@/lib/data/place-media'
import { addTripItem, createTrip, tripInputSchema, updateTripItem, type TripItemInput } from '@/lib/data/trips'
import { NOW } from '../fixtures'
import { commonsOk, json, router } from '../place-fixtures'
import { createTestDb } from '../test-db'

let db: AppDb
let userId: string
let tripId: string

const item = (title: string, extra: Partial<TripItemInput> = {}): TripItemInput => ({ kind: 'activity', title, day: 1, time: null, place: null, url: null, costUsd: null, points: null, notes: null, ...extra })
const molokiniSearch = () =>
  json({ query: { pages: [{ title: 'Molokini', index: 1, pageimage: 'Molokini_crater.jpg', coordinates: [{ lat: 20.633, lon: -156.496 }] }] } })

beforeAll(async () => {
  db = await createTestDb()
  userId = await ensureOwnerAccount(db, 'owner@example.com')
  tripId = await createTrip(db, userId, tripInputSchema.parse({ name: 'Maui', destination: 'Maui, Hawaii', startDate: '2026-12-04', endDate: '2026-12-07' }))
}, 60_000)

const deps = (fetch: typeof globalThis.fetch) => ({ fetch, now: NOW, minIntervalMs: 0 })
const row = async (id: string) => (await db.select().from(tripItems).where(eq(tripItems.id, id)))[0]!

describe('trip item maps and photos', () => {
  it('come from a Google Maps link without searching, and the link names the place', async () => {
    const calls: URL[] = []
    const f = router({ 'en.wikipedia.org': molokiniSearch, 'commons.wikimedia.org': () => commonsOk('Molokini_crater.jpg') }, calls)
    const r = await addTripItem(db, userId, tripId, item('Snorkel trip', { url: 'https://www.google.com/maps/place/Molokini/@20.63,-156.49,14z/data=!3d20.6339!4d-156.4964' }))
    if (!r.ok) throw new Error(r.error)
    expect(await enrichTripItem(db, userId, r.id, deps(f))).toEqual({ map: true, photo: true })
    const saved = await row(r.id)
    expect(saved).toMatchObject({ place: 'Molokini', lat: 20.6339, lng: -156.4964, photo: { credit: 'Forest & Kim Starr', license: 'CC BY 3.0' } })
    expect(saved.mediaCheckedAt?.toISOString()).toBe(NOW.toISOString())
    expect(calls.some((c) => c.hostname === 'nominatim.openstreetmap.org')).toBe(false)
    const [job] = await db.select().from(searchJobs).where(eq(searchJobs.provider, 'wikimedia'))
    expect(job).toMatchObject({ jobType: 'place_photo', status: 'succeeded' })
  })

  it('come from a place search near the destination, and are looked up only once', async () => {
    const calls: URL[] = []
    const f = router(
      {
        'nominatim.openstreetmap.org': (u) => {
          expect(u.searchParams.get('q')).toBe('Haleakala National Park, Maui, Hawaii')
          return json([{ lat: '20.72', lon: '-156.17', name: 'Haleakalā National Park', boundingbox: ['20.6', '20.8', '-156.3', '-156.0'], extratags: { wikidata: 'Q1069935' } }])
        },
        'www.wikidata.org': () => json({ claims: { P18: [{ mainsnak: { datavalue: { value: 'Haleakala_crater.jpg' } } }] } }),
        'commons.wikimedia.org': () => commonsOk('Haleakala_crater.jpg'),
      },
      calls,
    )
    const a = await addTripItem(db, userId, tripId, item('Sunrise', { place: 'Haleakala National Park' }))
    const b = await addTripItem(db, userId, tripId, item('Second visit', { place: 'Haleakala National Park', day: 2 }))
    if (!a.ok || !b.ok) throw new Error('add failed')
    await enrichTripItem(db, userId, a.id, deps(f))
    const used = calls.length
    await enrichTripItem(db, userId, b.id, deps(f))
    expect(calls.length).toBe(used)
    expect(await row(b.id)).toMatchObject({ lat: 20.72, lng: -156.17, mapSpan: expect.closeTo(0.3, 5), photo: { pageUrl: 'https://commons.wikimedia.org/wiki/File:Haleakala_crater.jpg' } })
  })

  it('move a Google Maps link pasted as the place into the link, keeping its name as the place', async () => {
    const f = router({ 'en.wikipedia.org': () => json({ query: { pages: [] } }) })
    const r = await addTripItem(db, userId, tripId, item('Dinner', { place: 'https://www.google.com/maps/place/Mama%27s+Fish+House/@20.93,-156.35,17z/data=!3d20.9389!4d-156.3549' }))
    if (!r.ok) throw new Error(r.error)
    expect(await enrichTripItem(db, userId, r.id, deps(f))).toEqual({ map: true, photo: false })
    expect(await row(r.id)).toMatchObject({ place: "Mama's Fish House", url: expect.stringContaining('google.com/maps/place'), lat: 20.9389, photo: null })
  })

  it('are cleared and looked up again when the place changes', async () => {
    const r = await addTripItem(db, userId, tripId, item('Beach', { place: 'Haleakala National Park' }))
    if (!r.ok) throw new Error(r.error)
    await enrichTripItem(db, userId, r.id, deps(router({})))
    expect((await row(r.id)).lat).toBe(20.72)
    const same = await updateTripItem(db, userId, r.id, item('Beach day', { place: 'Haleakala National Park' }))
    expect(same).toMatchObject({ ok: true, placeChanged: false })
    expect((await row(r.id)).lat).toBe(20.72)
    const moved = await updateTripItem(db, userId, r.id, item('Beach day', { place: 'Big Beach Makena' }))
    expect(moved).toMatchObject({ ok: true, placeChanged: true })
    expect(await row(r.id)).toMatchObject({ lat: null, lng: null, photo: null, mediaCheckedAt: null })
    expect((await itemsNeedingMedia(db, userId, tripId)).map((i) => i.id)).toContain(r.id)
  })

  it('leave the item without a map when the search fails, and note that it was tried', async () => {
    const r = await addTripItem(db, userId, tripId, item('Somewhere', { place: 'Unfindable Spot' }))
    if (!r.ok) throw new Error(r.error)
    const down = router({ 'nominatim.openstreetmap.org': () => new Response('busy', { status: 503 }) })
    expect(await enrichTripItem(db, userId, r.id, deps(down))).toEqual({ map: false, photo: false })
    expect(await row(r.id)).toMatchObject({ lat: null, photo: null })
    expect((await row(r.id)).mediaCheckedAt).not.toBeNull()
    const [failed] = await db.select().from(searchJobs).where(eq(searchJobs.status, 'failed'))
    expect(failed).toMatchObject({ provider: 'nominatim', error: 'Nominatim responded 503' })
  })

  it('belong to the trip owner only', async () => {
    const other = await ensureOwnerAccount(db, 'other@example.com')
    const r = await addTripItem(db, userId, tripId, item('Private', { place: 'Haleakala National Park' }))
    if (!r.ok) throw new Error(r.error)
    expect(await enrichTripItem(db, other, r.id, deps(router({})))).toEqual({ map: false, photo: false })
    expect((await row(r.id)).mediaCheckedAt).toBeNull()
  })
})
