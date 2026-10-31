/** Owner award search ("Anywhere" and single route) with fake seats.aero responses (TEST FIXTURES). */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppDb } from '@/lib/db/client'
import { searchJobs, transferPromotions } from '@/lib/db/schema'
import { ensureOwnerAccount } from '@/lib/data/account'
import { awardSearchSchema, runAwardSearch, type AwardSearchInput } from '@/lib/data/award-search'
import { airlineCodes, airlineNames, programUnit } from '@/lib/domain/airlines'
import { DISCOVERY_DESTINATIONS } from '@/lib/jobs/discovery'
import type { SeatsAeroItem } from '@/lib/providers/seats-aero'
import { NOW } from '../fixtures'
import { createTestDb } from '../test-db'

let db: AppDb
let userId: string

function item(id: string, origin: string, dest: string, date: string, miles: number): SeatsAeroItem {
  return {
    ID: id,
    Route: { OriginAirport: origin, DestinationAirport: dest },
    Date: date,
    Source: 'aeroplan',
    JAvailable: true,
    JMileageCostRaw: miles,
    JTotalTaxes: 3900,
    TaxesCurrency: 'USD',
    JAirlines: 'NH',
    UpdatedAt: '2026-10-18T09:00:00Z',
  }
}

/** Answers by destination list; unknown destinations get no results. */
function fakeSeats(byDest: Record<string, SeatsAeroItem[] | 'fail'>, calls: URL[] = []) {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input))
    calls.push(url)
    const dests = (url.searchParams.get('destination_airport') ?? '').split(',')
    if (dests.some((d) => byDest[d] === 'fail')) return new Response('nope', { status: 500 })
    const data = dests.flatMap((d) => (Array.isArray(byDest[d]) ? (byDest[d] as SeatsAeroItem[]) : []))
    return new Response(JSON.stringify({ data, count: data.length, hasMore: false }), { status: 200 })
  }) as typeof fetch
}

const base: AwardSearchInput = { origin: 'SAN', destination: null, includeHomeAirports: true, cabin: 'business', startDate: '2026-11-01', endDate: '2026-12-31' }

beforeAll(async () => {
  db = await createTestDb()
  userId = await ensureOwnerAccount(db, 'owner@example.com')
}, 60_000)

beforeEach(async () => {
  await db.delete(searchJobs)
})

describe('runAwardSearch', () => {
  it('searches every destination group from all home airports and lists the cheapest per city and month', async () => {
    const calls: URL[] = []
    const fetch = fakeSeats(
      {
        NRT: [item('a1', 'LAX', 'NRT', '2026-11-05', 90000), item('a2', 'LAX', 'NRT', '2026-11-20', 70000), item('a3', 'SFO', 'NRT', '2026-11-06', 40000)],
        LHR: [item('a4', 'SAN', 'LHR', '2026-12-02', 60000)],
      },
      calls,
    )
    const out = await runAwardSearch(db, userId, 'k', base, { now: NOW, fetch })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(calls).toHaveLength(DISCOVERY_DESTINATIONS.length)
    expect(new Set(calls.map((c) => c.searchParams.get('origin_airport')))).toEqual(new Set(['SAN,LAX,SNA,ONT,BUR']))
    expect(calls.every((c) => c.searchParams.get('cabin') === 'business')).toBe(true)
    expect(out.results.map((r) => [r.airport, r.points])).toEqual([
      ['LHR', 60000],
      ['NRT', 70000],
    ])
    expect(out.anywhere).toBe(true)
    expect(out.created).toBe(2)
  })

  it('can search from one airport only', async () => {
    const calls: URL[] = []
    const fetch = fakeSeats({ NRT: [item('b1', 'LAX', 'NRT', '2026-11-05', 70000), item('b2', 'SAN', 'NRT', '2026-11-09', 80000)] }, calls)
    const out = await runAwardSearch(db, userId, 'k', { ...base, includeHomeAirports: false }, { now: NOW, fetch })
    expect(calls[0]?.searchParams.get('origin_airport')).toBe('SAN')
    expect(out.ok && out.results.map((r) => r.origin)).toEqual(['SAN'])
  })

  it('searches one route when a destination is given, keeping every date', async () => {
    const calls: URL[] = []
    const fetch = fakeSeats({ HND: [item('c1', 'SAN', 'HND', '2026-11-05', 75000), item('c2', 'SAN', 'HND', '2026-11-06', 75000)] }, calls)
    const out = await runAwardSearch(db, userId, 'k', { ...base, destination: 'HND', includeHomeAirports: false }, { now: NOW, fetch })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.searchParams.get('destination_airport')).toBe('HND')
    expect(out.ok && out.results).toHaveLength(2)
  })

  it('reports partial failures but still returns what it found', async () => {
    const fetch = fakeSeats({ LHR: 'fail', NRT: [item('d1', 'LAX', 'NRT', '2026-11-05', 70000)] })
    const out = await runAwardSearch(db, userId, 'k', base, { now: NOW, fetch })
    expect(out.ok && out.failed).toBe(1)
    expect(out.ok && out.results.length).toBe(1)
  })

  it('fails clearly when every search fails', async () => {
    const fetch = (async () => new Response('down', { status: 503 })) as unknown as typeof globalThis.fetch
    const out = await runAwardSearch(db, userId, 'k', base, { now: NOW, fetch })
    expect(out).toEqual({ ok: false, error: 'seats.aero responded 503' })
  })

  it('refuses to start when the daily quota cannot cover the whole search', async () => {
    await db.insert(searchJobs).values({ provider: 'seats_aero', jobType: 'discovery', status: 'succeeded', requestCount: 995, startedAt: NOW, createdAt: NOW })
    const calls: URL[] = []
    const out = await runAwardSearch(db, userId, 'k', base, { now: NOW, fetch: fakeSeats({}, calls) })
    expect(out.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('validates the date range', () => {
    expect(awardSearchSchema.safeParse({ ...base, startDate: '2026-12-01', endDate: '2026-11-01' }).success).toBe(false)
    expect(awardSearchSchema.safeParse({ ...base, origin: 'San Diego' }).success).toBe(false)
  })
})

describe('airline and program filters', () => {
  const route = { ...base, origin: 'LAX', destination: 'NRT', includeHomeAirports: false }
  const rows = () => [
    { ...item('f1', 'LAX', 'NRT', '2026-11-10', 75000), Source: 'aeroplan', JAirlines: 'NH' },
    { ...item('f2', 'LAX', 'NRT', '2026-11-11', 80000), Source: 'united', JAirlines: 'UA, NH' },
    { ...item('f3', 'LAX', 'NRT', '2026-11-12', 60000), Source: 'united', JAirlines: 'UA' },
    { ...item('f4', 'LAX', 'NRT', '2026-11-13', 55000), Source: 'virginatlantic', JAirlines: 'NH' },
  ]

  it('keeps only awards flown by the chosen airline, including connections that use it', async () => {
    const out = await runAwardSearch(db, userId, 'k', { ...route, airline: 'NH' }, { now: NOW, fetch: fakeSeats({ NRT: rows() }) })
    expect(out.ok && out.results.map((r) => r.airline)).toEqual(['NH', 'NH', 'UA, NH'])
  })

  it('keeps only awards bookable with the chosen program', async () => {
    const out = await runAwardSearch(db, userId, 'k', { ...route, program: 'united' }, { now: NOW, fetch: fakeSeats({ NRT: rows() }) })
    expect(out.ok && out.results.map((r) => [r.programId, r.points])).toEqual([
      ['united', 60000],
      ['united', 80000],
    ])
    const both = await runAwardSearch(db, userId, 'k', { ...route, airline: 'NH', program: 'united' }, { now: NOW, fetch: fakeSeats({ NRT: rows() }) })
    expect(both.ok && both.results.map((r) => r.points)).toEqual([80000])
  })

  it('picks the cheapest date per city among the chosen airline only', async () => {
    const out = await runAwardSearch(db, userId, 'k', { ...base, includeHomeAirports: false, origin: 'LAX', airline: 'UA' }, { now: NOW, fetch: fakeSeats({ NRT: rows() }) })
    expect(out.ok && out.results.map((r) => [r.airport, r.points])).toEqual([['NRT', 60000]])
  })

  it('rejects airlines and programs it doesn’t know', () => {
    expect(awardSearchSchema.safeParse({ ...route, airline: 'ZZ' }).success).toBe(false)
    expect(awardSearchSchema.safeParse({ ...route, program: 'delta' }).success).toBe(false)
    expect(awardSearchSchema.parse(route)).toMatchObject({ airline: null, program: null })
  })

  it('names airlines and programs for the results', () => {
    expect(airlineCodes('UA, NH')).toEqual(['UA', 'NH'])
    expect(airlineNames('UA, NH')).toBe('United, ANA')
    expect(airlineNames('XX')).toBe('XX')
    expect(airlineNames('Multiple airlines')).toBe('Multiple airlines')
    expect(programUnit('aeroplan')).toBe('Aeroplan points')
    expect(programUnit('somethingelse')).toBe('miles')
  })
})

describe('cabin comparison, round trips, seats and transfer bonuses', () => {
  const route = { ...base, origin: 'LAX', destination: 'CUN', includeHomeAirports: false }
  /** One program's prices on one date in every cabin it has (miles; undefined = no seats). */
  function cabins(id: string, origin: string, dest: string, date: string, p: { Y?: number; W?: number; J?: number; F?: number }, extra: Partial<SeatsAeroItem> = {}): SeatsAeroItem {
    const row: SeatsAeroItem = { ID: id, Route: { OriginAirport: origin, DestinationAirport: dest }, Date: date, Source: 'united', TaxesCurrency: 'USD', UpdatedAt: '2026-10-18T09:00:00Z' }
    for (const c of ['Y', 'W', 'J', 'F'] as const) {
      const miles = p[c]
      if (miles == null) continue
      Object.assign(row, { [`${c}Available`]: true, [`${c}MileageCostRaw`]: miles, [`${c}TotalTaxes`]: 5600, [`${c}Airlines`]: 'UA', [`${c}Direct`]: true })
    }
    return { ...row, ...extra }
  }

  it('asks for every cabin in one request and lines them up side by side per date', async () => {
    const calls: URL[] = []
    const fetch = fakeSeats(
      {
        CUN: [
          cabins('k1', 'LAX', 'CUN', '2026-11-05', { Y: 15000, W: 25000, J: 20000 }),
          { ...cabins('k2', 'LAX', 'CUN', '2026-11-05', { Y: 12500, J: 35000 }), Source: 'aeroplan' },
          cabins('k3', 'LAX', 'CUN', '2026-11-08', { Y: 10000, F: 80000 }),
        ],
      },
      calls,
    )
    const out = await runAwardSearch(db, userId, 'k', { ...route, cabin: 'all' }, { now: NOW, fetch })
    if (!out.ok) throw new Error(out.error)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.searchParams.has('cabin')).toBe(false)
    expect(out.allCabins).toBe(true)
    expect(out.total).toBe(2)
    // Cheapest date first; each cabin keeps its cheapest program on that date.
    expect(out.compare!.map((r) => [r.when, Object.fromEntries(Object.entries(r.cells).map(([c, x]) => [c, [x!.points, x!.programId]]))])).toEqual([
      ['2026-11-08', { economy: [10000, 'united'], first: [80000, 'united'] }],
      ['2026-11-05', { economy: [12500, 'aeroplan'], premium_economy: [25000, 'united'], business: [20000, 'united'] }],
    ])
    expect(out.results.map((r) => r.cabin)).toEqual(['economy', 'economy', 'business', 'premium_economy', 'first'])
  })

  it('asks once per cabin when seats.aero insists on a cabin, and merges the answers', async () => {
    const calls: URL[] = []
    const rows = [cabins('m1', 'LAX', 'CUN', '2026-11-05', { Y: 15000, J: 40000 })]
    const fetch = (async (input: string | URL | Request) => {
      const url = new URL(String(input))
      calls.push(url)
      if (!url.searchParams.has('cabin')) return new Response('{"error":"cabin is required"}', { status: 400 })
      return new Response(JSON.stringify({ data: rows, hasMore: false }), { status: 200 })
    }) as typeof globalThis.fetch
    const out = await runAwardSearch(db, userId, 'k', { ...route, cabin: 'all' }, { now: NOW, fetch })
    if (!out.ok) throw new Error(out.error)
    expect(calls.map((c) => c.searchParams.get('cabin'))).toEqual([null, 'economy', 'premium', 'business', 'first'])
    expect(out.requests).toBe(5)
    expect(out.compare).toHaveLength(1)
    expect(Object.keys(out.compare![0]!.cells)).toEqual(['economy', 'business'])
    const [job] = await db.select().from(searchJobs)
    expect(job).toMatchObject({ status: 'succeeded', requestCount: 5, params: expect.objectContaining({ cabin: 'all' }) })
  })

  it('compares cabins per city and month when searching anywhere', async () => {
    const fetch = fakeSeats({
      NRT: [cabins('n1', 'LAX', 'NRT', '2026-11-05', { Y: 35000, J: 90000 }), cabins('n2', 'LAX', 'NRT', '2026-11-20', { Y: 40000, J: 70000 })],
    })
    const out = await runAwardSearch(db, userId, 'k', { ...base, origin: 'LAX', includeHomeAirports: false, cabin: 'all' }, { now: NOW, fetch })
    if (!out.ok) throw new Error(out.error)
    expect(out.compare).toHaveLength(1)
    const row = out.compare![0]!
    expect(row).toMatchObject({ city: 'Tokyo', when: '2026-11' })
    expect([row.cells.economy?.date, row.cells.economy?.points, row.cells.business?.date, row.cells.business?.points]).toEqual(['2026-11-05', 35000, '2026-11-20', 70000])
  })

  it('leaves out flights with too few seats, keeps those that do not say, and labels them', async () => {
    const fetch = fakeSeats({
      CUN: [
        cabins('s1', 'LAX', 'CUN', '2026-11-05', { J: 30000 }, { JRemainingSeats: 1 }),
        cabins('s2', 'LAX', 'CUN', '2026-11-06', { J: 35000 }, { JRemainingSeats: 0 }),
        cabins('s3', 'LAX', 'CUN', '2026-11-07', { J: 40000 }, { JRemainingSeats: 4 }),
      ],
    })
    const two = await runAwardSearch(db, userId, 'k', { ...route, seats: 2 }, { now: NOW, fetch })
    if (!two.ok) throw new Error(two.error)
    expect(two.results.map((r) => [r.date, r.seats])).toEqual([
      ['2026-11-06', null],
      ['2026-11-07', 4],
    ])
    expect(two.hiddenForSeats).toBe(1)
    const one = await runAwardSearch(db, userId, 'k', route, { now: NOW, fetch })
    expect(one.ok && one.results.map((r) => r.seats)).toEqual([1, null, 4])
  })

  it('searches the way back for a round trip and finds the cheapest pair per cabin, back on or after out', async () => {
    const calls: URL[] = []
    const fetch = fakeSeats(
      {
        CUN: [cabins('r1', 'LAX', 'CUN', '2026-11-05', { Y: 15000, J: 30000 }), cabins('r2', 'LAX', 'CUN', '2026-11-12', { Y: 9000 })],
        LAX: [cabins('r3', 'CUN', 'LAX', '2026-11-10', { Y: 12000, J: 25000 }), cabins('r4', 'CUN', 'LAX', '2026-11-04', { Y: 5000 }), cabins('r5', 'CUN', 'LAX', '2026-11-14', { Y: 14000 })],
      },
      calls,
    )
    const out = await runAwardSearch(
      db,
      userId,
      'k',
      { ...route, cabin: 'all', tripType: 'round_trip', startDate: '2026-11-01', endDate: '2026-11-15', returnStart: '2026-11-03', returnEnd: '2026-11-20' },
      { now: NOW, fetch },
    )
    if (!out.ok) throw new Error(out.error)
    expect(calls.map((c) => [c.searchParams.get('origin_airport'), c.searchParams.get('destination_airport'), c.searchParams.get('start_date'), c.searchParams.get('end_date')])).toEqual([
      ['LAX', 'CUN', '2026-11-01', '2026-11-15'],
      ['CUN', 'LAX', '2026-11-03', '2026-11-20'],
    ])
    expect(out.roundTrip).toBe(true)
    expect(out.returnLeg?.compare?.map((r) => r.when)).toEqual(['2026-11-04', '2026-11-10', '2026-11-14'])
    // Economy: the 5,000 return on Nov 4 is before every departure, so it can't be used; Nov 12 out + Nov 14 back (23,000) beats Nov 5 + Nov 10 (27,000).
    expect(out.roundTrips.map((p) => [p.cabin, p.out.date, p.back.date, p.points])).toEqual([
      ['economy', '2026-11-12', '2026-11-14', 23000],
      ['business', '2026-11-05', '2026-11-10', 55000],
    ])
    expect(out.roundTrips[0]!.taxesUsd).toBe(112)
  })

  it('needs a destination and return dates for a round trip', () => {
    const rt = { ...route, tripType: 'round_trip' as const, returnStart: '2026-11-10', returnEnd: '2026-11-20' }
    expect(awardSearchSchema.safeParse(rt).success).toBe(true)
    expect(awardSearchSchema.safeParse({ ...rt, destination: null }).error?.issues[0]?.message).toBe('A round trip needs a "To" airport.')
    expect(awardSearchSchema.safeParse({ ...rt, returnStart: null }).error?.issues[0]?.message).toBe('Choose the dates you could fly back.')
    expect(awardSearchSchema.safeParse({ ...rt, returnStart: '2026-11-20', returnEnd: '2026-11-10' }).success).toBe(false)
    expect(awardSearchSchema.safeParse({ ...rt, returnStart: '2026-10-01', returnEnd: '2026-10-05' }).error?.issues[0]?.message).toBe('The return dates must be after you leave.')
    expect(awardSearchSchema.safeParse({ ...route, seats: 5 }).success).toBe(false)
  })

  it('flags an active Chase transfer bonus and counts the Chase points with it, ignoring targeted or ended ones', async () => {
    const promo = { bonusPercent: 30, startsAt: new Date('2026-10-01T00:00:00Z'), sourceKind: 'manual' as const, verificationStatus: 'owner_verified' as const }
    await db.insert(transferPromotions).values([
      { ...promo, partnerId: 'aeroplan', endsAt: new Date('2026-11-15T04:59:00Z'), endsAtTimezone: 'America/New_York' },
      { ...promo, partnerId: 'united', bonusPercent: 50, isTargeted: true, endsAt: null },
      { ...promo, partnerId: 'flying_blue', endsAt: new Date('2026-10-10T00:00:00Z') },
    ])
    try {
      const fetch = fakeSeats({
        CUN: [
          { ...cabins('b1', 'LAX', 'CUN', '2026-11-05', { J: 60000 }), Source: 'aeroplan' },
          cabins('b2', 'LAX', 'CUN', '2026-11-06', { J: 55000 }),
          { ...cabins('b3', 'LAX', 'CUN', '2026-11-07', { J: 50000 }), Source: 'flyingblue' },
        ],
      })
      const out = await runAwardSearch(db, userId, 'k', route, { now: NOW, fetch })
      if (!out.ok) throw new Error(out.error)
      // 60,000 Aeroplan points need 47,000 Chase points with a 30% bonus (1,000-point steps), so it ranks first.
      expect(out.results.map((r) => [r.programId, r.points, r.chasePoints, r.bonus?.percent ?? null])).toEqual([
        ['aeroplan', 60000, 47000, 30],
        ['flying_blue', 50000, 50000, null],
        ['united', 55000, 55000, null],
      ])
      expect(out.results[0]!.bonus).toMatchObject({ partnerName: 'Air Canada', endsAt: '2026-11-15T04:59:00.000Z', endsAtTimezone: 'America/New_York', verification: 'owner_verified', chasePointsWithout: 60000 })
    } finally {
      await db.delete(transferPromotions)
    }
  })
})
