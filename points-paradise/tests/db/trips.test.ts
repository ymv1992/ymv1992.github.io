/** My Trips: days and ideas, rearranging, ticking off, sharing, deal watches and the PDF itinerary. */
import { beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { PDFDocument } from 'pdf-lib'
import type { AppDb } from '@/lib/db/client'
import { deals, watchlists } from '@/lib/db/schema'
import { ensureOwnerAccount } from '@/lib/data/account'
import { runAwardSearch } from '@/lib/data/award-search'
import { getDeal } from '@/lib/data/deals'
import {
  addDealToTrip,
  addTripItem,
  arrangeTrip,
  createTrip,
  dealsForTrip,
  deleteTrip,
  deleteTripItem,
  getSharedTrip,
  getTrip,
  setTripItemDone,
  setTripSharing,
  tripDayCount,
  tripInputSchema,
  tripItemInputSchema,
  tripTotals,
  tripWatchWindow,
  unwatchTrip,
  updateTrip,
  watchTrip,
  type TripItemInput,
} from '@/lib/data/trips'
import { buildTripPdf } from '@/lib/trips/trip-pdf'
import { NOW } from '../fixtures'
import { createTestDb } from '../test-db'

let db: AppDb
let userId: string
let otherId: string

const item = (title: string, extra: Partial<TripItemInput> = {}): TripItemInput => ({ kind: 'activity', title, day: null, time: null, place: null, url: null, costAmount: null, costCurrency: 'USD', points: null, notes: null, ...extra })
const trip = (extra: Record<string, unknown> = {}) => tripInputSchema.parse({ name: 'Maui', destination: 'Maui, Hawaii', destAirport: 'ogg', startDate: '2026-12-04', endDate: '2026-12-07', ...extra })

beforeAll(async () => {
  db = await createTestDb()
  userId = await ensureOwnerAccount(db, 'owner@example.com')
  otherId = await ensureOwnerAccount(db, 'someone-else@example.com')
}, 60_000)

describe('trip details', () => {
  it('count days from the dates, or use the chosen number for a someday trip', async () => {
    const dated = (await getTrip(db, userId, await createTrip(db, userId, trip())))!.trip
    expect(dated.destAirport).toBe('OGG')
    expect(tripDayCount(dated)).toBe(4)
    const someday = (await getTrip(db, userId, await createTrip(db, userId, trip({ startDate: '', endDate: '', dayCount: '5' }))))!.trip
    expect(tripDayCount(someday)).toBe(5)
  })

  it('validate what is typed', () => {
    expect(tripInputSchema.safeParse({ name: 'x', startDate: '2026-12-04', endDate: '' }).success).toBe(false)
    expect(tripInputSchema.safeParse({ name: 'x', startDate: '2026-12-04', endDate: '2027-02-01' }).success).toBe(false)
    expect(tripInputSchema.safeParse({ name: 'x', destAirport: 'Maui' }).success).toBe(false)
    expect(tripItemInputSchema.safeParse(item('Luau', { url: 'javascript:alert(1)' })).success).toBe(false)
    expect(tripItemInputSchema.safeParse(item('Luau', { time: '25:00' })).success).toBe(false)
    expect(tripItemInputSchema.parse({ ...item('Luau'), day: 'ideas', time: '18:30', costAmount: '', costCurrency: '' })).toMatchObject({ day: null, time: '18:30', costAmount: null, costCurrency: 'USD' })
    expect(tripItemInputSchema.safeParse({ ...item('Luau'), costAmount: 10, costCurrency: 'XXX' }).success).toBe(false)
  })
})

describe('items', () => {
  it('go on a day or into ideas, can be moved between them, ticked off and removed', async () => {
    const id = await createTrip(db, userId, trip())
    const a = await addTripItem(db, userId, id, item('Road to Hana', { day: 1, points: 0, costAmount: 40 }))
    const b = await addTripItem(db, userId, id, item('Snorkel Molokini', { day: 1, costAmount: 120 }))
    const c = await addTripItem(db, userId, id, item('Sunset at Haleakala'))
    if (!a.ok || !b.ok || !c.ok) throw new Error('add failed')
    expect((await addTripItem(db, userId, id, item('Too late', { day: 9 }))).ok).toBe(false)

    // Drag: Haleakala onto day 2, and Molokini above Road to Hana on day 1.
    const r = await arrangeTrip(db, userId, id, [
      { day: 1, ids: [b.id, a.id] },
      { day: 2, ids: [c.id] },
      { day: null, ids: [] },
    ])
    expect(r.ok).toBe(true)
    let t = (await getTrip(db, userId, id))!
    expect(t.items.map((i) => `${i.day}:${i.title}`)).toEqual(['1:Snorkel Molokini', '1:Road to Hana', '2:Sunset at Haleakala'])

    await setTripItemDone(db, userId, b.id, true)
    await deleteTripItem(db, userId, a.id)
    t = (await getTrip(db, userId, id))!
    expect(tripTotals(t.items, t.trip.rates)).toEqual({ items: 2, done: 1, points: 0, cashUsd: 120, unconverted: {} })
  })

  it('refuse a rearrangement that is stale or names other items', async () => {
    const id = await createTrip(db, userId, trip())
    const a = await addTripItem(db, userId, id, item('One', { day: 1 }))
    const b = await addTripItem(db, userId, id, item('Two', { day: 1 }))
    if (!a.ok || !b.ok) throw new Error('add failed')
    expect((await arrangeTrip(db, userId, id, [{ day: 1, ids: [a.id] }])).ok).toBe(false)
    expect((await arrangeTrip(db, userId, id, [{ day: 1, ids: [a.id, b.id, a.id] }])).ok).toBe(false)
    expect((await arrangeTrip(db, userId, id, [{ day: 7, ids: [a.id, b.id] }])).ok).toBe(false)
    const t = (await getTrip(db, userId, id))!
    expect(t.items.map((i) => i.title)).toEqual(['One', 'Two'])
  })

  it('move to ideas, not disappear, when the trip gets shorter', async () => {
    const id = await createTrip(db, userId, trip())
    await addTripItem(db, userId, id, item('Day four dinner', { day: 4 }))
    await updateTrip(db, userId, id, trip({ endDate: '2026-12-05' }))
    const t = (await getTrip(db, userId, id))!
    expect(tripDayCount(t.trip)).toBe(2)
    expect(t.items[0]).toMatchObject({ title: 'Day four dinner', day: null })
  })

  it('belong to their owner only', async () => {
    const id = await createTrip(db, userId, trip())
    const a = await addTripItem(db, userId, id, item('Mine', { day: 1 }))
    if (!a.ok) throw new Error('add failed')
    expect(await getTrip(db, otherId, id)).toBeNull()
    expect((await addTripItem(db, otherId, id, item('Sneaky'))).ok).toBe(false)
    expect((await arrangeTrip(db, otherId, id, [{ day: 2, ids: [a.id] }])).ok).toBe(false)
    await deleteTripItem(db, otherId, a.id)
    await setTripItemDone(db, otherId, a.id, true)
    await deleteTrip(db, otherId, id)
    const t = (await getTrip(db, userId, id))!
    expect(t.items).toHaveLength(1)
    expect(t.items[0]!.done).toBe(false)
  })
})

describe('sharing', () => {
  it('works only while the link is on', async () => {
    const id = await createTrip(db, userId, trip({ name: 'Shared' }))
    await addTripItem(db, userId, id, item('Luau', { day: 2 }))
    const token = await setTripSharing(db, userId, id, true)
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(await setTripSharing(db, userId, id, true)).toBe(token)
    expect((await getSharedTrip(db, token!))?.items.map((i) => i.title)).toEqual(['Luau'])
    expect(await setTripSharing(db, otherId, id, false)).toBeNull()
    await setTripSharing(db, userId, id, false)
    expect(await getSharedTrip(db, token!)).toBeNull()
    expect(await getSharedTrip(db, "' or 1=1 --")).toBeNull()
  })
})

describe('deals and watches', () => {
  const seats = (id: string, date: string) => ({ ID: id, Route: { OriginAirport: 'LAX', DestinationAirport: 'OGG' }, Date: date, Source: 'united', JAvailable: true, JMileageCostRaw: 40000, JTotalTaxes: 560, TaxesCurrency: 'USD', JAirlines: 'UA', JDirect: true })
  const search = (rows: unknown[]) =>
    runAwardSearch(db, userId, 'k', { origin: 'LAX', destination: 'OGG', includeHomeAirports: false, cabin: 'business', startDate: '2026-12-01', endDate: '2026-12-31' }, {
      now: NOW,
      fetch: (async () => new Response(JSON.stringify({ data: rows }))) as typeof fetch,
    })

  it('adds a deal on its travel day, or to ideas when it falls outside the trip', async () => {
    await search([seats('t1', '2026-12-05'), seats('t2', '2026-12-20')])
    const id = await createTrip(db, userId, trip())
    const [inside] = await db.select().from(deals).where(eq(deals.sourceRef, 't1'))
    const [outside] = await db.select().from(deals).where(eq(deals.sourceRef, 't2'))
    expect((await addDealToTrip(db, userId, id, (await getDeal(db, inside!.id))!, 40000)).ok).toBe(true)
    expect((await addDealToTrip(db, userId, id, (await getDeal(db, outside!.id))!, 40000)).ok).toBe(true)
    const t = (await getTrip(db, userId, id))!
    expect(t.items.map((i) => [i.kind, i.day, i.points, i.dealId != null])).toEqual([
      ['flight', null, 40000, true],
      ['flight', 2, 40000, true],
    ])
    expect(t.items[0]!.notes).toMatch(/outside this trip/)
    expect(tripTotals(t.items, t.trip.rates).cashUsd).toBeCloseTo(11.2)
  })

  it('finds award flights already known for the trip', async () => {
    const found = await dealsForTrip(db, { destAirport: 'OGG', startDate: '2026-12-04' }, '2026-10-18')
    const [t1] = await db.select().from(deals).where(eq(deals.sourceRef, 't1'))
    expect(found.map((d) => d.id)).toEqual([t1!.id])
  })

  it('watches around the start date, or the coming year for a someday trip', () => {
    expect(tripWatchWindow({ startDate: '2026-12-04' }, '2026-10-18')).toEqual({ dateFrom: '2026-12-01', dateTo: '2026-12-07' })
    expect(tripWatchWindow({ startDate: '2026-10-19' }, '2026-10-18')).toEqual({ dateFrom: '2026-10-18', dateTo: '2026-10-22' })
    expect(tripWatchWindow({ startDate: null }, '2026-10-18')).toEqual({ dateFrom: '2026-10-18', dateTo: '2027-09-13' })
  })

  it('creates one seats.aero route watch per trip and removes it with the trip', async () => {
    const noAirport = await createTrip(db, userId, trip({ destAirport: '' }))
    expect(await watchTrip(db, userId, noAirport, { origins: ['SAN'], cabin: 'business', seatsAeroConfigured: true, now: NOW })).toMatchObject({ ok: false })
    const id = await createTrip(db, userId, trip({ name: 'Watched' }))
    const first = await watchTrip(db, userId, id, { origins: ['SAN', 'LAX'], cabin: 'business', seatsAeroConfigured: true, now: NOW })
    const again = await watchTrip(db, userId, id, { origins: ['SAN'], cabin: 'first', seatsAeroConfigured: true, now: NOW })
    if (!first.ok || !again.ok) throw new Error('watch failed')
    const rows = await db.select().from(watchlists).where(eq(watchlists.label, 'Trip: Watched'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'route', origins: ['SAN'], destinations: ['OGG'], cabin: 'first', dateFrom: '2026-12-01', dateTo: '2026-12-07', provider: 'seats_aero', autoCheckSupported: true })
    await unwatchTrip(db, userId, id)
    expect(await db.select().from(watchlists).where(eq(watchlists.label, 'Trip: Watched'))).toHaveLength(0)
    const third = await watchTrip(db, userId, id, { origins: ['SAN'], cabin: 'business', seatsAeroConfigured: true, now: NOW })
    if (!third.ok) throw new Error('watch failed')
    await deleteTrip(db, userId, id)
    expect(await db.select().from(watchlists).where(eq(watchlists.id, third.watchId))).toHaveLength(0)
  })
})

describe('PDF itinerary', () => {
  it('lays out every day and idea, copes with any characters, and runs over pages', async () => {
    const id = await createTrip(db, userId, trip({ name: 'Japan → Maui ✈️', destination: '東京 and Maui' }))
    for (let i = 0; i < 40; i++) await addTripItem(db, userId, id, item(`Stop ${i} at Café “Ōkubo” 🍣`, { day: (i % 4) + 1, time: '09:30', notes: 'A long note '.repeat(20), url: 'https://example.com/a/very/long/link/that/needs/breaking/'.repeat(3) }))
    await addTripItem(db, userId, id, item('Maybe a luau'))
    const t = (await getTrip(db, userId, id))!
    await setTripItemDone(db, userId, t.items[0]!.id, true)
    const bytes = await buildTripPdf(t.trip, (await getTrip(db, userId, id))!.items, NOW)
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBeGreaterThan(3)
    expect(doc.getTitle()).toBe('Japan → Maui ✈️ itinerary')
  })
})
