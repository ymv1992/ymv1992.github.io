/** Locked trip exchange rates: fetched once, kept until updated, overridable, and used for dollar totals (TEST FIXTURES). */
import { beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/client'
import { searchJobs, trips } from '@/lib/db/schema'
import { ensureOwnerAccount } from '@/lib/data/account'
import { ensureTripRates, refreshTripRate, setTripRate, tripCurrenciesInUse } from '@/lib/data/trip-rates'
import { addTripItem, createTrip, getTrip, listTrips, tripInputSchema, tripTotals, type TripItemInput } from '@/lib/data/trips'
import { NOW } from '../fixtures'
import { json, router } from '../place-fixtures'
import { createTestDb } from '../test-db'

let db: AppDb
let userId: string

const item = (title: string, extra: Partial<TripItemInput> = {}): TripItemInput => ({ kind: 'food', title, day: 1, time: null, place: null, url: null, costAmount: null, costCurrency: 'USD', points: null, notes: null, ...extra })
const ecb = (perUsd: number, date = '2026-10-17') => router({ 'api.frankfurter.dev': (u) => json({ date, rates: { [u.searchParams.get('symbols')!]: perUsd } }) })
const deps = (fetch: typeof globalThis.fetch, now = NOW) => ({ fetch, now })
const rates = async (id: string) => (await db.select({ r: trips.rates }).from(trips).where(eq(trips.id, id)))[0]!.r

beforeAll(async () => {
  db = await createTestDb()
  userId = await ensureOwnerAccount(db, 'owner@example.com')
}, 60_000)

describe('trip exchange rates', () => {
  it('lock today’s rate once, and keep it until updated', async () => {
    const id = await createTrip(db, userId, tripInputSchema.parse({ name: 'Tokyo', currency: 'JPY' }))
    expect(await ensureTripRates(db, userId, id, ['JPY'], deps(ecb(150)))).toEqual([])
    expect((await rates(id)).JPY).toEqual({ perUsd: 150, source: 'ecb', asOf: '2026-10-17' })
    // A later save doesn't move it, even if the market did.
    await ensureTripRates(db, userId, id, ['JPY'], deps(ecb(160)))
    expect((await rates(id)).JPY!.perUsd).toBe(150)
    // Until the owner asks for today's rate.
    expect(await refreshTripRate(db, userId, id, 'JPY', deps(ecb(160, '2026-10-28')))).toMatchObject({ perUsd: 160 })
    expect((await rates(id)).JPY).toEqual({ perUsd: 160, source: 'ecb', asOf: '2026-10-28' })
    const [job] = await db.select().from(searchJobs).where(eq(searchJobs.provider, 'frankfurter'))
    expect(job).toMatchObject({ jobType: 'exchange_rate', status: 'succeeded' })
  })

  it('accept the owner’s own rate, and report currencies no source has', async () => {
    const id = await createTrip(db, userId, tripInputSchema.parse({ name: 'Tahiti', currency: 'XPF' }))
    expect(await ensureTripRates(db, userId, id, ['XPF'], deps(router({})))).toEqual(['XPF'])
    expect(await setTripRate(db, userId, id, 'XPF', 112.5, NOW)).toBe(true)
    expect((await rates(id)).XPF).toEqual({ perUsd: 112.5, source: 'manual', asOf: '2026-10-18' })
    expect(await setTripRate(db, userId, id, 'XPF', 0, NOW)).toBe(false)
    expect(await setTripRate(db, userId, id, 'USD', 1, NOW)).toBe(false)
    const other = await ensureOwnerAccount(db, 'other@example.com')
    expect(await setTripRate(db, other, id, 'XPF', 1, NOW)).toBe(false)
  })

  it('turn local costs into dollar totals, and list what still needs a rate', async () => {
    const id = await createTrip(db, userId, tripInputSchema.parse({ name: 'Japan and Korea', currency: 'JPY', startDate: '2026-12-01', endDate: '2026-12-05' }))
    await ensureTripRates(db, userId, id, ['JPY'], deps(ecb(150)))
    await addTripItem(db, userId, id, item('Sushi', { costAmount: 12000, costCurrency: 'JPY' }))
    await addTripItem(db, userId, id, item('Train', { costAmount: 45, costCurrency: 'USD' }))
    await addTripItem(db, userId, id, item('Seoul market', { costAmount: 30000, costCurrency: 'KRW' }))
    const t = (await getTrip(db, userId, id))!
    expect(await tripCurrenciesInUse(db, t.trip)).toEqual(expect.arrayContaining(['JPY', 'KRW']))
    expect(tripTotals(t.items, t.trip.rates)).toMatchObject({ cashUsd: 125, unconverted: { KRW: 30000 } })
    await ensureTripRates(db, userId, id, ['KRW'], deps(ecb(1500)))
    const list = await listTrips(db, userId)
    expect(list.find((x) => x.id === id)?.totals).toMatchObject({ cashUsd: 145, unconverted: {} })
  })
})
