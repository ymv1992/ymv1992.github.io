/** Maps and photos for trip items: from Google Maps links or place names, cached, and refreshed when the place changes (TEST FIXTURES). */
import { beforeAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/client'
import { searchJobs, tripItems } from '@/lib/db/schema'
import { ensureOwnerAccount } from '@/lib/data/account'
import { enrichTripItem, itemsNeedingMedia } from '@/lib/data/place-media'
import { addTripItem, createTrip, tripInputSchema, updateTripItem, type TripItemInput } from '@/lib/data/trips'
import { NOW } from '../fixtures'
import { commonsOk, json, reverseOk, router } from '../place-fixtures'
import { createTestDb } from '../test-db'

let db: AppDb
let userId: string
let tripId: string

const item = (title: string, extra: Partial<TripItemInput> = {}): TripItemInput => ({ kind: 'activity', title, day: 1, time: null, place: null, url: null, costAmount: null, costCurrency: 'USD', points: null, notes: null, ...extra })
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
    const f = router(
      {
        'en.wikipedia.org': molokiniSearch,
        'commons.wikimedia.org': () => commonsOk('Molokini_crater.jpg'),
        'nominatim.openstreetmap.org': (u) => (u.pathname === '/reverse' ? reverseOk('Kihei') : null),
      },
      calls,
    )
    const r = await addTripItem(db, userId, tripId, item('Snorkel trip', { url: 'https://www.google.com/maps/place/Molokini/@20.63,-156.49,14z/data=!3d20.6339!4d-156.4964' }))
    if (!r.ok) throw new Error(r.error)
    expect(await enrichTripItem(db, userId, r.id, deps(f))).toEqual({ map: true, photo: true })
    const saved = await row(r.id)
    expect(saved).toMatchObject({ place: 'Molokini', lat: 20.6339, lng: -156.4964, photo: { credit: 'Forest & Kim Starr', license: 'CC BY 3.0' }, city: 'Kihei', countryCode: 'US' })
    expect(saved.mediaCheckedAt?.toISOString()).toBe(NOW.toISOString())
    // No place search: the pin comes from the link. Only the town it's in is asked for.
    expect(calls.filter((c) => c.hostname === 'nominatim.openstreetmap.org').map((c) => c.pathname)).toEqual(['/reverse'])
    const [job] = await db.select().from(searchJobs).where(eq(searchJobs.provider, 'wikimedia'))
    expect(job).toMatchObject({ jobType: 'place_photo', status: 'succeeded' })
  })

  it('come from a place search near the destination, and are looked up only once', async () => {
    const calls: URL[] = []
    const f = router(
      {
        'nominatim.openstreetmap.org': (u) => {
          if (u.pathname === '/reverse') return reverseOk('Kula')
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
    const [failed] = await db.select().from(searchJobs).where(and(eq(searchJobs.status, 'failed'), eq(searchJobs.jobType, 'place_lookup')))
    expect(failed).toMatchObject({ provider: 'nominatim', error: 'Nominatim responded 503' })
  })

  it('read share.google links: the place name from the link, the pin from a search near the destination', async () => {
    const searches: string[] = []
    const f = router({
      'share.google': () => new Response(null, { status: 302, headers: { location: 'https://www.google.com/search?q=Capela+das+Almas&kgmid=/g/11b6' } }),
      'nominatim.openstreetmap.org': (u) => {
        if (u.pathname === '/reverse') return reverseOk('Porto', 'pt')
        searches.push(u.searchParams.get('q')!)
        return json([{ lat: '41.1492', lon: '-8.6062', name: 'Capela das Almas', boundingbox: ['41.1491', '41.1493', '-8.6063', '-8.6061'], extratags: { wikidata: 'Q2939413' } }])
      },
      'www.wikidata.org': () => json({ claims: { P18: [{ mainsnak: { datavalue: { value: 'Capela_das_Almas.jpg' } } }] } }),
      'commons.wikimedia.org': () => commonsOk('Capela_das_Almas.jpg'),
    })
    const r = await addTripItem(db, userId, tripId, item('Beautiful church', { url: 'https://share.google/Qi3LxU6EOSquROmFc' }))
    if (!r.ok) throw new Error(r.error)
    expect(await enrichTripItem(db, userId, r.id, deps(f))).toEqual({ map: true, photo: true })
    expect(searches).toEqual(['Capela das Almas, Maui, Hawaii'])
    expect(await row(r.id)).toMatchObject({ place: 'Capela das Almas', lat: 41.1492, photo: { pageUrl: 'https://commons.wikimedia.org/wiki/File:Capela_das_Almas.jpg' }, city: 'Porto', countryCode: 'PT' })
  })

  it('search the title near the destination when there is no place or readable link, and name what was found', async () => {
    const searches: string[] = []
    const f = router({
      'nominatim.openstreetmap.org': (u) => {
        if (u.pathname === '/reverse') return reverseOk('Porto', 'pt')
        const q = u.searchParams.get('q')!
        searches.push(q)
        return json(q === 'Torre dos Clérigos, Maui, Hawaii' ? [{ lat: '41.1457', lon: '-8.6146', name: 'Torre dos Clérigos' }] : [])
      },
      'en.wikipedia.org': () => json({ query: { pages: [] } }),
    })
    const r = await addTripItem(db, userId, tripId, item('Torre dos Clérigos (climb at sunset)', { url: 'https://example.com/tickets' }))
    if (!r.ok) throw new Error(r.error)
    expect(await enrichTripItem(db, userId, r.id, deps(f))).toEqual({ map: true, photo: false })
    // Only near the destination, then without the "(…)" aside; never worldwide.
    expect(searches).toEqual(['Torre dos Clérigos (climb at sunset), Maui, Hawaii', 'Torre dos Clérigos, Maui, Hawaii'])
    expect(await row(r.id)).toMatchObject({ place: 'Torre dos Clérigos', lat: 41.1457, url: 'https://example.com/tickets' })
  })

  it('skip notes, and record links it could not read', async () => {
    const calls: URL[] = []
    const note = await addTripItem(db, userId, tripId, item('Travel day', { kind: 'note' }))
    if (!note.ok) throw new Error(note.error)
    expect(await enrichTripItem(db, userId, note.id, deps(router({}, calls)))).toEqual({ map: false, photo: false })
    expect(calls).toHaveLength(0)
    const r = await addTripItem(db, userId, tripId, item('Xyzzy', { url: 'https://share.google/broken' }))
    if (!r.ok) throw new Error(r.error)
    await enrichTripItem(db, userId, r.id, deps(router({ 'share.google': () => new Response('<html>', { status: 200 }) })))
    const jobs = await db.select().from(searchJobs).where(eq(searchJobs.provider, 'google_links'))
    expect(jobs.find((j) => j.status === 'failed')).toMatchObject({ jobType: 'place_link', error: 'Could not read a place from this link', params: { host: 'share.google', readable: false } })
  })

  it('belong to the trip owner only', async () => {
    const other = await ensureOwnerAccount(db, 'other@example.com')
    const r = await addTripItem(db, userId, tripId, item('Private', { place: 'Haleakala National Park' }))
    if (!r.ok) throw new Error(r.error)
    expect(await enrichTripItem(db, other, r.id, deps(router({})))).toEqual({ map: false, photo: false })
    expect((await row(r.id)).mediaCheckedAt).toBeNull()
  })
})
