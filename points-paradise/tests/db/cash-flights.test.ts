/** Cash fares from Google Flights and the Chase points each earns (TEST FIXTURES). */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppDb } from '@/lib/db/client'
import { searchJobs } from '@/lib/db/schema'
import { cashSearchSchema, searchCashFlights } from '@/lib/data/cash-flights'
import { compareEarning, FLIGHT_EARN } from '@/lib/domain/earning'
import { CARD_TYPE_IDS } from '@/lib/domain/constants'
import { searchCashFares } from '@/lib/providers/serpapi'
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
    expect(ok.ok && ok.itineraries).toHaveLength(2)
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
