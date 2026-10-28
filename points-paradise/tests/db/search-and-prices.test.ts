/** Cash-price lookups, hotel search and award-search values with fake provider responses (TEST FIXTURES). */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/client'
import { dataSources, deals, searchJobs } from '@/lib/db/schema'
import { ensureOwnerAccount } from '@/lib/data/account'
import { runAwardSearch } from '@/lib/data/award-search'
import { lookupCashPrice } from '@/lib/data/cash-prices'
import { getDeal } from '@/lib/data/deals'
import { evaluateMany } from '@/lib/data/evaluation'
import { hotelSearchSchema, runHotelSearch } from '@/lib/data/hotel-search'
import { NOW } from '../fixtures'
import { createTestDb } from '../test-db'

let db: AppDb
let userId: string

function json(body: unknown, status = 200, calls: URL[] = []) {
  return (async (input: string | URL | Request) => {
    calls.push(new URL(String(input)))
    return new Response(JSON.stringify(body), { status })
  }) as typeof fetch
}

const seatsBody = {
  data: [
    { ID: 's1', Route: { OriginAirport: 'LAX', DestinationAirport: 'NRT' }, Date: '2026-12-05', Source: 'united', JAvailable: true, JMileageCostRaw: 80000, JTotalTaxes: 5600, TaxesCurrency: 'USD', JAirlines: 'UA', JDirect: true },
  ],
  hasMore: false,
}
const googleFlights = { best_flights: [{ price: 4800, total_duration: 690, flights: [{ airline: 'United', flight_number: 'UA 32', travel_class: 'Business' }] }] }

beforeAll(async () => {
  db = await createTestDb()
  userId = await ensureOwnerAccount(db, 'owner@example.com')
}, 60_000)

beforeEach(async () => {
  await db.delete(searchJobs)
})

const flightInput = { origin: 'LAX', destination: 'NRT', includeHomeAirports: false, cabin: 'business' as const, startDate: '2026-12-01', endDate: '2026-12-31' }

describe('award search values', () => {
  it('returns Chase points with each result and no value until a cash price is known', async () => {
    const out = await runAwardSearch(db, userId, 'k', flightInput, { now: NOW, fetch: json(seatsBody) })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.results[0]).toMatchObject({ chasePoints: 80000, cashUsd: null, cpp: null, cashLookupTried: false })
  })
})

describe('lookupCashPrice', () => {
  it('adds the Google Flights price and makes the value calculable', async () => {
    const [row] = await db.select().from(deals).where(eq(deals.sourceRef, 's1'))
    const deal = (await getDeal(db, row!.id))!
    const r = await lookupCashPrice(db, deal, { apiKey: 'k', now: NOW, fetch: json(googleFlights), monthlyCapUsd: 5, jobType: 'cash_lookup' })
    expect(r).toEqual({ status: 'priced', cashUsd: 4800 })
    const e = (await evaluateMany(db, userId, [deal.id], NOW)).get(deal.id)
    expect(e?.valuation.calculable).toBe(true)
    // ($4,800 − $56) ÷ 80,000 × 100
    expect(e?.valuation.headlineCpp).toBeCloseTo(5.93, 2)
    const [job] = await db.select().from(searchJobs)
    expect(job).toMatchObject({ provider: 'serpapi_flights', jobType: 'cash_lookup', status: 'succeeded', requestCount: 1 })
  })

  it('keeps the cash price when a later search refreshes the same flight', async () => {
    const out = await runAwardSearch(db, userId, 'k', flightInput, { now: NOW, fetch: json(seatsBody) })
    expect(out.ok && out.results[0]).toMatchObject({ cashUsd: 4800, cpp: expect.any(Number) })
  })

  it('remembers a lookup that found no fare so it is not repeated every run', async () => {
    await runAwardSearch(db, userId, 'k', { ...flightInput, destination: 'HND' }, { now: NOW, fetch: json({ data: [{ ...seatsBody.data[0], ID: 's2', Route: { OriginAirport: 'LAX', DestinationAirport: 'HND' } }] }) })
    const [row] = await db.select().from(deals).where(eq(deals.sourceRef, 's2'))
    const r = await lookupCashPrice(db, (await getDeal(db, row!.id))!, { apiKey: 'k', now: NOW, fetch: json({ best_flights: [] }), monthlyCapUsd: 5, jobType: 'cash_lookup' })
    expect(r).toEqual({ status: 'not_found', reason: 'Google Flights had no business fare from LAX to HND on Dec 5, 2026.' })
    const [after] = await db.select().from(deals).where(eq(deals.id, row!.id))
    expect(after?.comparableCashUsd).toBeNull()
    expect(after?.comparableCashObservedAt?.toISOString()).toBe(NOW.toISOString())
    const again = await runAwardSearch(db, userId, 'k', { ...flightInput, destination: 'HND' }, { now: NOW, fetch: json({ data: [{ ...seatsBody.data[0], ID: 's2', Route: { OriginAirport: 'LAX', DestinationAirport: 'HND' } }] }) })
    expect(again.ok && again.results[0]?.cashLookupTried).toBe(true)
  })

  it('explains a failed lookup in plain words', async () => {
    const [row] = await db.select().from(deals).where(eq(deals.sourceRef, 's2'))
    const r = await lookupCashPrice(db, (await getDeal(db, row!.id))!, { apiKey: 'bad', now: NOW, fetch: json({ error: 'Invalid API key.' }, 401), monthlyCapUsd: 5, jobType: 'cash_lookup' })
    expect(r).toEqual({ status: 'failed', reason: 'SerpApi did not accept the key. Check SERPAPI_API_KEY in Vercel.' })
    const [job] = await db.select().from(searchJobs).where(eq(searchJobs.status, 'failed'))
    expect(job?.error).toMatch(/401/)
  })

  it('stops at the monthly allowance', async () => {
    const [src] = await db.select().from(dataSources).where(eq(dataSources.id, 'serpapi_flights'))
    expect(src?.monthlyQuota).toBe(200)
    await db.insert(searchJobs).values({ provider: 'serpapi_flights', jobType: 'cash_enrichment', status: 'succeeded', requestCount: 200, startedAt: NOW, createdAt: NOW })
    const [row] = await db.select().from(deals).where(eq(deals.sourceRef, 's2'))
    const calls: URL[] = []
    const r = await lookupCashPrice(db, (await getDeal(db, row!.id))!, { apiKey: 'k', now: NOW, fetch: json(googleFlights, 200, calls), monthlyCapUsd: 5, jobType: 'cash_lookup' })
    expect(r.status).toBe('skipped')
    expect(calls).toHaveLength(0)
  })
})

describe('automatic cash lookups', () => {
  it('price first and business class before economy, and skip flights tried recently', async () => {
    const icn = (id: string, extra: Record<string, unknown>) => ({ ID: id, Route: { OriginAirport: 'LAX', DestinationAirport: 'ICN' }, Date: '2026-12-08', Source: 'united', TaxesCurrency: 'USD', ...extra })
    await runAwardSearch(db, userId, 'k', { ...flightInput, destination: 'ICN', cabin: 'economy' }, { now: NOW, fetch: json({ data: [icn('e1', { YAvailable: true, YMileageCostRaw: 35000, YTotalTaxes: 5600 })] }) })
    await runAwardSearch(db, userId, 'k', { ...flightInput, destination: 'ICN' }, { now: NOW, fetch: json({ data: [icn('b1', { JAvailable: true, JMileageCostRaw: 75000, JTotalTaxes: 5600 })] }) })
    await db.delete(searchJobs)
    const calls: URL[] = []
    const { runJobs } = await import('@/lib/jobs/run')
    await runJobs(db, { now: NOW, sendEmail: null, appUrl: 'http://localhost:3000', keys: { seatsAero: null, serpApi: 'k', unsplash: null }, rssFeeds: [], fetch: json({ best_flights: [] }, 200, calls) }, 'manual')
    const serp = calls.filter((c) => c.hostname === 'serpapi.com')
    expect(serp.map((c) => `${c.searchParams.get('arrival_id')}:${c.searchParams.get('travel_class')}`)).toEqual(['ICN:3', 'ICN:1'])
  })
})

describe('runHotelSearch', () => {
  const rows = [
    { hotel: { id: 'h1', source: 'marriott', name: 'Example Marriott Resort', brand: 'Marriott', city: 'Wailea', country: 'United States' }, lowest_award_standard: 120000, lowest_cash_standard: 150000, currency_code: 'USD', standard_date: '2026-12-10', standard_nights: 3, cpp: 1.25 },
    { hotel: { id: 'h2', source: 'hyatt', name: 'Example Hyatt Regency', brand: 'Hyatt Regency', city: 'Kaanapali', country: 'United States' }, lowest_award_standard: 75000, lowest_cash_standard: 210000, currency_code: 'USD', standard_date: '2026-12-12', standard_nights: 3, cpp: 2.8 },
    { hotel: { id: 'h3', source: 'hilton', name: 'Example Hilton', brand: 'Hilton', city: 'Wailea', country: 'United States' }, lowest_award_standard: 90000, lowest_cash_standard: 100000, currency_code: 'USD', standard_date: '2026-12-10', standard_nights: 3, cpp: 1.1 },
  ]
  const input = { place: 'Maui, Hawaii', startDate: '2026-12-01', endDate: '2026-12-31', nights: 3, programs: ['hyatt', 'marriott', 'ihg', 'wyndham'] }

  it('searches the place and lists Chase-partner stays with their value, best first', async () => {
    const calls: URL[] = []
    const out = await runHotelSearch(db, userId, 'k', input, { now: NOW, fetch: json({ data: rows, has_more: false }, 200, calls) })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(calls[0]?.searchParams.get('location')).toBe('Maui, Hawaii')
    expect(calls[0]?.searchParams.get('source')).toBe('hyatt,marriott,ihg,wyndham')
    expect(out.results.map((r) => r.hotel)).toEqual(['Example Hyatt Regency', 'Example Marriott Resort'])
    const hyatt = out.results[0]!
    // 75,000 Hyatt = 100,000 Chase points at the reported 4:3 Sapphire Preferred ratio; $2,100 / 100,000 = 2.1¢.
    expect(hyatt.chasePoints).toBe(100000)
    expect(hyatt.cpp).toBeCloseTo(2.1, 2)
    const [job] = await db.select().from(searchJobs).where(eq(searchJobs.jobType, 'user_hotel_search'))
    expect(job).toMatchObject({ provider: 'rooms_aero', status: 'succeeded' })
  })

  it('reports a place rooms.aero cannot find', async () => {
    const out = await runHotelSearch(db, userId, 'k', { ...input, place: 'Atlantis' }, { now: NOW, fetch: json({ error: 'location_not_found' }, 400) })
    expect(out).toMatchObject({ ok: true, placeFound: false, total: 0 })
  })

  it('validates the search', () => {
    expect(hotelSearchSchema.safeParse({ ...input, programs: [] }).success).toBe(false)
    expect(hotelSearchSchema.safeParse({ ...input, nights: 9 }).success).toBe(false)
    expect(hotelSearchSchema.safeParse({ ...input, startDate: '2026-12-31', endDate: '2026-12-01' }).success).toBe(false)
  })
})
