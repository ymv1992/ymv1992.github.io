/** Owner award search ("Anywhere" and single route) with fake seats.aero responses (TEST FIXTURES). */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppDb } from '@/lib/db/client'
import { searchJobs } from '@/lib/db/schema'
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
