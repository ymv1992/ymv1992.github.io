/** Cash fares from Google Flights and the Chase points each earns (TEST FIXTURES). */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppDb } from '@/lib/db/client'
import { searchJobs } from '@/lib/db/schema'
import { cashSearchSchema, searchCashFlights } from '@/lib/data/cash-flights'
import { compareEarning, FLIGHT_EARN } from '@/lib/domain/earning'
import { CARD_TYPE_IDS } from '@/lib/domain/constants'
import { exploreCashFares, searchCashFares } from '@/lib/providers/serpapi'
import { NOW } from '../fixtures'
import { json, router } from '../place-fixtures'
import { createTestDb } from '../test-db'

let db: AppDb

const seg = (from: string, to: string, dep: string, arr: string, extra: Record<string, unknown> = {}) => ({
  departure_airport: { id: from, time: dep },
  arrival_airport: { id: to, time: arr },
  airline: 'United',
  flight_number: 'UA 1',
  airplane: 'Boeing 737',
  travel_class: 'Economy',
  ...extra,
})
const google = (calls: URL[] = []) =>
  router({
    'serpapi.com': (u) => {
      calls.push(u)
      return json({
        best_flights: [{ flights: [seg('LAX', 'CUN', '2026-11-05 08:05', '2026-11-05 15:40', { flight_number: 'UA 1234', airplane: 'Boeing 737MAX 9 Passenger' })], total_duration: 275, price: 489 }],
        other_flights: [
          {
            flights: [seg('LAX', 'IAH', '2026-11-05 22:00', '2026-11-06 03:30'), seg('IAH', 'CUN', '2026-11-06 07:00', '2026-11-06 09:45', { airline: 'Spirit', flight_number: 'NK 5' })],
            layovers: [{ id: 'IAH', duration: 210, overnight: true }],
            total_duration: 645,
            price: 312,
          },
          { flights: [seg('LAX', 'CUN', '2026-11-05 10:00', '2026-11-05 17:00')] },
        ],
        price_insights: { lowest_price: 312, price_level: 'typical', typical_price_range: [280, 520] },
        search_metadata: { google_flights_url: 'https://www.google.com/travel/flights?hl=en&tfs=abc' },
      })
    },
  })

beforeAll(async () => {
  db = await createTestDb()
}, 60_000)
beforeEach(async () => {
  await db.delete(searchJobs)
})

describe('Chase points on cash flights', () => {
  it('know every card, and earn more through Chase Travel on the cards that reward it', () => {
    for (const id of CARD_TYPE_IDS) expect(FLIGHT_EARN[id]).toBeDefined()
    expect(FLIGHT_EARN.sapphire_reserve).toMatchObject({ direct: 4, chaseTravel: 8 })
    expect(FLIGHT_EARN.sapphire_preferred).toMatchObject({ direct: 2, chaseTravel: 5 })
  })

  it('compare booking with the airline and through Chase Travel, and find the price where they break even', () => {
    const c = compareEarning(489, FLIGHT_EARN.sapphire_reserve, 1)
    expect([c.directPoints, c.chaseTravelPoints]).toEqual([1956, 3912])
    expect(c.directNetUsd).toBeCloseTo(469.44, 2)
    expect(c.chaseTravelNetUsd).toBeCloseTo(449.88, 2)
    // At 1¢ a point: 489 × 0.96 / 0.92 ≈ $510.26 — Chase Travel is worth it until it charges about $21 more.
    expect(c.breakEvenChasePriceUsd).toBeCloseTo(510.26, 2)
    const pricier = compareEarning(489, FLIGHT_EARN.sapphire_reserve, 1, 540)
    expect(pricier.chaseTravelNetUsd).toBeGreaterThan(pricier.directNetUsd)
    // Same rate both ways: no reason to pay Chase more.
    expect(compareEarning(300, FLIGHT_EARN.ink_business_preferred, 1.5).breakEvenChasePriceUsd).toBeCloseTo(300, 6)
  })
})

describe('Google Flights cash fares', () => {
  it('list each option with times, stops, aircraft and Google’s price view', async () => {
    const calls: URL[] = []
    const r = await searchCashFares('k', { from: 'LAX', to: 'CUN', date: '2026-11-05', returnDate: '2026-11-12', cabin: 'economy', adults: 2, nonstop: false }, google(calls))
    expect(calls[0]!.searchParams.get('type')).toBe('1')
    expect(calls[0]!.searchParams.get('return_date')).toBe('2026-11-12')
    expect(calls[0]!.searchParams.get('adults')).toBe('2')
    expect(r?.itineraries.map((i) => [i.priceUsd, i.airlines, i.departTime, i.arriveTime, i.arriveDayOffset, i.stops, i.via, i.overnightLayover, i.best])).toEqual([
      [489, 'United', '08:05', '15:40', 0, 0, [], false, true],
      [312, 'United, Spirit', '22:00', '09:45', 1, 1, ['IAH'], true, false],
    ])
    expect(r?.itineraries[0]!.aircraft).toBe('Boeing 737MAX 9 Passenger')
    expect(r?.insights).toEqual({ lowestUsd: 312, level: 'typical', typicalLowUsd: 280, typicalHighUsd: 520 })
    expect(r?.googleFlightsUrl).toBe('https://www.google.com/travel/flights?hl=en&tfs=abc')
    const oneWay: URL[] = []
    await searchCashFares('k', { from: 'LAX', to: 'CUN', date: '2026-11-05', returnDate: null, cabin: 'business', adults: 1, nonstop: true }, google(oneWay))
    expect(Object.fromEntries([...oneWay[0]!.searchParams].filter(([k]) => ['type', 'travel_class', 'stops'].includes(k)))).toEqual({ type: '2', travel_class: '3', stops: '1' })
  })

  it('use one search from the monthly allowance, and refuse past dates and full months', async () => {
    const input = cashSearchSchema.parse({ from: 'lax', to: 'cun', date: '2026-11-05', returnDate: '', cabin: 'economy', adults: '1', nonstop: false })
    const calls: URL[] = []
    const ok = await searchCashFlights(db, input, { apiKey: 'k', now: NOW, fetch: google(calls), monthlyCapUsd: 10 })
    expect(ok.ok && ok.mode === 'route' && ok.itineraries).toHaveLength(2)
    const [job] = await db.select().from(searchJobs)
    expect(job).toMatchObject({ provider: 'serpapi_flights', jobType: 'cash_search', status: 'succeeded', requestCount: 1 })
    expect(await searchCashFlights(db, { ...input, date: '2026-10-01' }, { apiKey: 'k', now: NOW, fetch: google(calls), monthlyCapUsd: 10 })).toEqual({ ok: false, error: 'Choose a date from today on.' })
    await db.insert(searchJobs).values({ provider: 'serpapi_flights', jobType: 'cash_lookup', status: 'succeeded', requestCount: 200, startedAt: NOW, createdAt: NOW })
    const full = await searchCashFlights(db, input, { apiKey: 'k', now: NOW, fetch: google(calls), monthlyCapUsd: 10 })
    expect(full.ok).toBe(false)
    expect(calls).toHaveLength(1)
  })

  it('check the search before spending anything', () => {
    expect(cashSearchSchema.safeParse({ from: 'LAX', to: 'LAX', date: '2026-11-05', cabin: 'economy' }).error?.issues[0]?.message).toBe('From and To are the same airport')
    expect(cashSearchSchema.safeParse({ from: 'LAX', to: 'CUN', date: '2026-11-05', returnDate: '2026-11-01', cabin: 'economy' }).error?.issues[0]?.message).toBe('The return is before the departure')
    expect(cashSearchSchema.safeParse({ from: 'Los Angeles', to: 'CUN', date: '2026-11-05', cabin: 'economy' }).success).toBe(false)
  })
})

describe('Anywhere (Google’s Explore view)', () => {
  const explore = (calls: URL[] = []) =>
    router({
      'serpapi.com': (u) => {
        calls.push(u)
        return json({
          destinations: [
            { name: 'Cancún', country: 'Mexico', destination_airport: { code: 'CUN' }, start_date: '2026-11-05', end_date: '2026-11-12', flight_price: 289, hotel_price: 120, airline: 'United', number_of_stops: 0, flight_duration: 275, link: 'https://www.google.com/travel/explore?tfs=1', thumbnail: 'https://lh3.googleusercontent.com/x' },
            { name: 'Honolulu', country: 'United States', airport_code: 'hnl', flight_price: '$412', stops: 1, flight_duration: '5 hr 50 min' },
            { name: 'Somewhere', country: 'Nowhere' },
            { name: 'Lima', destination_airport: 'LIM', flight_price: 199, link: 'https://evil.example/x' },
          ],
        })
      },
    })

  it('reads every destination with a price, cheapest first, keeping only Google’s own links', async () => {
    const calls: URL[] = []
    const d = await exploreCashFares('k', { from: 'LAX', date: '2026-11-05', returnDate: '2026-11-12' }, explore(calls))
    expect(Object.fromEntries([...calls[0]!.searchParams].filter(([k]) => ['engine', 'departure_id', 'outbound_date', 'return_date'].includes(k)))).toEqual({
      engine: 'google_travel_explore',
      departure_id: 'LAX',
      outbound_date: '2026-11-05',
      return_date: '2026-11-12',
    })
    expect(d.map((x) => [x.city, x.airport, x.priceUsd, x.stops, x.duration, x.link])).toEqual([
      ['Lima', 'LIM', 199, null, null, null],
      ['Cancún', 'CUN', 289, 0, '4h 35m', 'https://www.google.com/travel/explore?tfs=1'],
      ['Honolulu', 'HNL', 412, 1, '5 hr 50 min', null],
    ])
    expect(d[1]).toMatchObject({ country: 'Mexico', startDate: '2026-11-05', endDate: '2026-11-12', hotelPriceUsd: 120, airline: 'United' })
  })

  it('runs when “To” is empty, using one search', async () => {
    const input = cashSearchSchema.parse({ from: 'LAX', to: '', date: '2026-11-05', returnDate: '2026-11-12', cabin: 'economy' })
    expect(input.to).toBeNull()
    expect(cashSearchSchema.parse({ from: 'LAX', to: 'anywhere', date: '2026-11-05', cabin: 'economy' }).to).toBeNull()
    const calls: URL[] = []
    const r = await searchCashFlights(db, input, { apiKey: 'k', now: NOW, fetch: explore(calls), monthlyCapUsd: 10 })
    expect(r.ok && r.mode === 'anywhere' && r.destinations.map((x) => x.city)).toEqual(['Lima', 'Cancún', 'Honolulu'])
    expect(calls).toHaveLength(1)
    const [job] = await db.select().from(searchJobs)
    expect(job).toMatchObject({ provider: 'serpapi_flights', jobType: 'cash_explore', status: 'succeeded', requestCount: 1, resultsCount: 3 })
    const none = await searchCashFlights(db, input, { apiKey: 'k', now: NOW, fetch: router({ 'serpapi.com': () => json({ destinations: [] }) }), monthlyCapUsd: 10 })
    expect(none).toEqual({ ok: false, error: 'Google didn’t show any destinations from LAX for those dates. Try other dates.' })
  })
})
