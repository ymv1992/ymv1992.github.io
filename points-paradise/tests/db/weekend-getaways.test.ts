/** Weekend getaways: the coming weekends, and the cheapest way out and back per city (TEST FIXTURES). */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppDb } from '@/lib/db/client'
import { searchJobs } from '@/lib/db/schema'
import { ensureOwnerAccount } from '@/lib/data/account'
import { findWeekendGetaways, weekendWindows } from '@/lib/data/weekend-getaways'
import { DISCOVERY_DESTINATIONS } from '@/lib/jobs/discovery'
import type { SeatsAeroItem } from '@/lib/providers/seats-aero'
import { NOW } from '../fixtures'
import { createTestDb } from '../test-db'

let db: AppDb
let userId: string

const row = (id: string, from: string, to: string, date: string, miles: number, extra: Partial<SeatsAeroItem> = {}): SeatsAeroItem => ({
  ID: id,
  Route: { OriginAirport: from, DestinationAirport: to, Distance: extra.Route?.Distance ?? 1500 },
  Date: date,
  Source: 'united',
  YAvailable: true,
  YMileageCostRaw: miles,
  YTotalTaxes: 560,
  TaxesCurrency: 'USD',
  YAirlines: 'UA',
  ...extra,
})

/** Answers each request with the rows whose airports are in its origin and destination lists. */
function fakeSeats(rows: SeatsAeroItem[], calls: URL[] = []) {
  return (async (input: string | URL | Request) => {
    const u = new URL(String(input))
    calls.push(u)
    const from = u.searchParams.get('origin_airport')!.split(',')
    const to = u.searchParams.get('destination_airport')!.split(',')
    const start = u.searchParams.get('start_date')!
    const end = u.searchParams.get('end_date')!
    const data = rows.filter((r) => from.includes(r.Route.OriginAirport) && to.includes(r.Route.DestinationAirport) && r.Date >= start && r.Date <= end)
    return new Response(JSON.stringify({ data, hasMore: false }), { status: 200 })
  }) as typeof fetch
}

beforeAll(async () => {
  db = await createTestDb()
  userId = await ensureOwnerAccount(db, 'owner@example.com')
}, 60_000)
beforeEach(async () => {
  await db.delete(searchJobs)
})

describe('weekends', () => {
  it('start with the next Friday and leave out travel days already past', () => {
    // Sunday Oct 18, 2026.
    expect(weekendWindows('2026-10-18', 2, 'long')).toEqual([
      { label: 'Thu, Oct 22 – Mon, Oct 26', friday: '2026-10-23', outDates: ['2026-10-22', '2026-10-23'], backDates: ['2026-10-25', '2026-10-26'] },
      { label: 'Thu, Oct 29 – Mon, Nov 2', friday: '2026-10-30', outDates: ['2026-10-29', '2026-10-30'], backDates: ['2026-11-01', '2026-11-02'] },
    ])
    expect(weekendWindows('2026-10-22', 1, 'long')[0]!.outDates).toEqual(['2026-10-23'])
    expect(weekendWindows('2026-10-23', 1, 'short')[0]).toMatchObject({ friday: '2026-10-30', outDates: ['2026-10-30'], backDates: ['2026-11-01'] })
  })
})

describe('findWeekendGetaways', () => {
  const base = { origin: 'LAX', includeHomeAirports: false, weeks: 2, shape: 'long' as const }

  it('pairs the cheapest way out and back per city each weekend, cheapest first, in Chase points', async () => {
    const calls: URL[] = []
    const rows = [
      row('o1', 'LAX', 'CUN', '2026-10-22', 15000),
      row('o2', 'LAX', 'CUN', '2026-10-23', 12500),
      row('b1', 'CUN', 'LAX', '2026-10-25', 10000),
      row('b2', 'CUN', 'LAX', '2026-10-26', 9000),
      row('o3', 'LAX', 'SJD', '2026-10-23', 7500),
      row('b3', 'SJD', 'LAX', '2026-10-25', 7500),
      // Saturday and Tuesday don't count; nor does a city with no way back.
      row('o4', 'LAX', 'PVR', '2026-10-24', 5000),
      row('b4', 'PVR', 'LAX', '2026-10-25', 5000),
      row('o5', 'LAX', 'MEX', '2026-10-23', 5000),
      // Too far for the default flight length.
      row('o6', 'LAX', 'LIH', '2026-10-23', 5000, { Route: { OriginAirport: 'LAX', DestinationAirport: 'LIH', Distance: 2600 } }),
      row('b6', 'LIH', 'LAX', '2026-10-25', 5000, { Route: { OriginAirport: 'LIH', DestinationAirport: 'LAX', Distance: 2600 } }),
    ]
    const out = await findWeekendGetaways(db, userId, 'k', base, { now: NOW, fetch: fakeSeats(rows, calls) })
    if (!out.ok) throw new Error(out.error)
    expect(calls).toHaveLength(DISCOVERY_DESTINATIONS.length * 2)
    expect(calls.every((c) => c.searchParams.get('cabin') === 'economy')).toBe(true)
    const first = out.windows[0]!
    expect(first.picks.map((p) => [p.airport, p.out.date, p.back.date, p.chasePoints, p.taxesUsd])).toEqual([
      ['SJD', '2026-10-23', '2026-10-25', 15000, 11.2],
      // 12,500 + 9,000 United miles: one transfer, rounded up to Chase's 1,000-point steps.
      ['CUN', '2026-10-23', '2026-10-26', 22000, 11.2],
    ])
    expect(out.windows[1]!.picks).toEqual([])
    expect(out.destinations).toBe(2)
    expect(first.picks[0]!.out.dealId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('can include long flights, and leaves out flights without enough seats', async () => {
    const rows = [
      row('o6', 'LAX', 'LIH', '2026-10-23', 5000, { Route: { OriginAirport: 'LAX', DestinationAirport: 'LIH', Distance: 2600 }, YRemainingSeats: 4 }),
      row('b6', 'LIH', 'LAX', '2026-10-25', 5000, { Route: { OriginAirport: 'LIH', DestinationAirport: 'LAX', Distance: 2600 }, YRemainingSeats: 1 }),
      row('b7', 'LIH', 'LAX', '2026-10-26', 8000, { Route: { OriginAirport: 'LIH', DestinationAirport: 'LAX', Distance: 2600 } }),
    ]
    const any = await findWeekendGetaways(db, userId, 'k', { ...base, maxMiles: null, seats: 2 }, { now: NOW, fetch: fakeSeats(rows) })
    if (!any.ok) throw new Error(any.error)
    expect(any.windows[0]!.picks.map((p) => [p.airport, p.back.date, p.back.seats, p.points])).toEqual([['LIH', '2026-10-26', null, 13000]])
    expect(any.hiddenForSeats).toBe(1)
  })

  it('refuses to start when the daily quota can’t cover both ways', async () => {
    await db.insert(searchJobs).values({ provider: 'seats_aero', jobType: 'discovery', status: 'succeeded', requestCount: 990, startedAt: NOW, createdAt: NOW })
    const calls: URL[] = []
    const out = await findWeekendGetaways(db, userId, 'k', base, { now: NOW, fetch: fakeSeats([], calls) })
    expect(out).toEqual({ ok: false, error: 'Daily seats.aero request limit reached. Try again tomorrow.' })
    expect(calls).toHaveLength(0)
  })
})
