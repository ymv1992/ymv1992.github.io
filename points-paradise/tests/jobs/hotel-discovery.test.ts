/** Hotel discovery through rooms.aero with fake responses (TEST FIXTURES — invented hotels and prices). */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, isNull } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/client'
import { appState, deals, notifications, searchJobs, userSettings } from '@/lib/db/schema'
import { ensureOwnerAccount, loadAccount } from '@/lib/data/account'
import { loadEvaluationData } from '@/lib/data/evaluation'
import { HOTEL_DAILY_CAP, HOTEL_METHOD, HOTEL_PLACES, hotelPlaces, runHotelDiscovery } from '@/lib/jobs/hotel-discovery'
import { runJobs, type JobDeps } from '@/lib/jobs/run'
import { hotelRowToDeals, type HotelSearchRow } from '@/lib/providers/rooms-aero'
import { NOW } from '../fixtures'
import { createTestDb } from '../test-db'

let db: AppDb
let userId: string

function row(id: string, name: string, over: Partial<HotelSearchRow> & { source?: string; brand?: string } = {}): Record<string, unknown> {
  const { source = 'hyatt', brand = 'Grand Hyatt', ...rest } = over
  return {
    hotel: { id, source, program: source, name, brand, award_category: 5, city: 'Tokyo', country: 'Japan', latitude: 35.68, longitude: 139.69, image_url: 'https://example.com/h.jpg', url: 'https://example.com/hotel' },
    lowest_award_standard: 75000,
    lowest_award_suite: 0,
    lowest_cash_standard: 180000,
    lowest_cash_suite: 0,
    currency_code: 'USD',
    standard_date: '2026-11-10',
    suite_date: null,
    standard_nights: 3,
    suite_nights: 0,
    cpp: 2.4,
    last_checked_at: '2026-10-17T10:00:00Z',
    ...rest,
  }
}

function respond(rows: Record<string, unknown>[], calls: Request[] = [], status = 200) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push(new Request(String(input), init))
    return new Response(JSON.stringify(status === 200 ? { data: rows, count: rows.length, has_more: false } : { error: 'location_not_found', message: 'Could not find that place' }), { status })
  }) as typeof fetch
}

const LIMITS = { maxCalls: 1, timeBudgetMs: 60_000 }

beforeAll(async () => {
  db = await createTestDb()
  userId = await ensureOwnerAccount(db, 'owner@example.com')
  const [s] = await db.select().from(userSettings).where(eq(userSettings.userId, userId))
  await db
    .update(userSettings)
    .set({ alertPrefs: { ...s!.alertPrefs!, quietHoursStart: null, quietHoursEnd: null } })
    .where(eq(userSettings.userId, userId))
}, 60_000)

beforeEach(async () => {
  await db.delete(searchJobs)
  await db.delete(appState).where(eq(appState.key, 'hotels:cursor'))
})

describe('hotelRowToDeals', () => {
  const place = HOTEL_PLACES[0]!

  it('turns a row into standard and suite deals with the cash rate for the same stay', () => {
    const deals = hotelRowToDeals(
      row('h1', 'Park Hyatt Tokyo', { brand: 'Park Hyatt', lowest_award_suite: 120000, suite_date: '2026-12-01', suite_nights: 3, lowest_cash_suite: 420000 }) as HotelSearchRow,
      place,
      3,
      HOTEL_METHOD,
    )
    expect(deals).toHaveLength(2)
    const [std, suite] = deals
    expect(std).toMatchObject({ kind: 'hotel', programId: 'hyatt', programPoints: 75000, comparableCashUsd: 1800, mandatoryCashUsd: 0, travelStart: '2026-11-10', travelEnd: '2026-11-13', nights: 3 })
    expect(std!.hotel).toMatchObject({ property: 'Park Hyatt Tokyo', roomType: 'standard', programCategory: 'Category 5', isStandardAward: true })
    expect(std!.tags).toContain('luxury')
    expect(suite).toMatchObject({ programPoints: 120000, comparableCashUsd: 4200 })
    expect(suite!.hotel?.roomType).toBe('suite')
  })

  it('skips programs that are not Chase partners and leaves non-USD cash uncompared', () => {
    expect(hotelRowToDeals(row('h2', 'Conrad', { source: 'hilton', brand: 'Conrad' }) as HotelSearchRow, place, 3, HOTEL_METHOD)).toEqual([])
    const [d] = hotelRowToDeals(row('h3', 'Hyatt Regency', { currency_code: 'JPY' }) as HotelSearchRow, place, 3, HOTEL_METHOD)
    expect(d?.comparableCashUsd).toBeNull()
    expect(d?.missingInfo).toContain('Comparable cash price')
  })

  it('alternates regions so every batch spans the world', () => {
    const order = hotelPlaces([])
    expect(order).toHaveLength(HOTEL_PLACES.length)
    expect(new Set(order.slice(0, 8).map((p) => p.region)).size).toBe(8)
    expect(order.slice(0, 4).map((p) => p.label)).toEqual(['Tokyo, Japan', 'Maldives', 'Maui, Hawaii', 'Fiji'])
  })

  it('adds dream destinations not already covered', () => {
    const places = hotelPlaces(['Tokyo', 'Patagonia', ''])
    expect(places[0]?.label).toBe('Patagonia')
    expect(places).toHaveLength(HOTEL_PLACES.length + 1)
  })
})

describe('runHotelDiscovery', () => {
  it('searches rooms.aero for Chase hotel partners and stores valued finds', async () => {
    const calls: Request[] = []
    const r = await runHotelDiscovery(db, userId, { now: NOW, apiKey: 'k', fetch: respond([row('a1', 'Grand Hyatt Tokyo'), row('a2', 'Conrad Tokyo', { source: 'hilton', brand: 'Conrad' })], calls) }, LIMITS)
    expect(r).toMatchObject({ calls: 1, newDeals: 1 })
    const url = new URL(calls[0]!.url)
    expect(url.origin + url.pathname).toBe('https://rooms.aero/partnerapi/search')
    expect(url.searchParams.get('location')).toBe('Tokyo, Japan')
    expect(url.searchParams.get('source')).toBe('hyatt,marriott,ihg,wyndham')
    // Stay length follows the profile's shortest trip, kept within rooms.aero's 1–5 nights.
    const { profile } = await loadAccount(db, userId)
    expect(url.searchParams.get('nights')).toBe(String(Math.min(5, Math.max(1, profile.tripNightsMin ?? 3))))
    expect(calls[0]!.headers.get('Partner-Authorization')).toBe('k')
    const [job] = await db.select().from(searchJobs)
    expect(job).toMatchObject({ provider: 'rooms_aero', jobType: 'hotel_discovery', status: 'succeeded', resultsCount: 1 })
    expect(job?.params).toMatchObject({ returned: 2, unreadable: 0 })
    const data = await loadEvaluationData(db, userId, { now: NOW })
    const found = data.items.find((e) => e.deal.hotel?.property === 'Grand Hyatt Tokyo')
    expect(found?.valuation.calculable).toBe(true)
    // 75,000 Hyatt points = 100,000 Chase points at the reported 4:3 Sapphire Preferred ratio: $1,800 / 100,000 = 1.8¢.
    expect(found?.valuation.chasePoints).toBe(100000)
    expect(found?.valuation.headlineCpp).toBeCloseTo(1.8, 2)
  })

  it('keeps one current date per hotel and room type', async () => {
    await runHotelDiscovery(db, userId, { now: NOW, apiKey: 'k', fetch: respond([row('a1', 'Grand Hyatt Tokyo', { standard_date: '2026-11-20' })]) }, LIMITS)
    const live = await db
      .select()
      .from(deals)
      .where(and(eq(deals.verificationMethod, HOTEL_METHOD), isNull(deals.archivedAt)))
    expect(live.filter((d) => d.hotel?.property === 'Grand Hyatt Tokyo').map((d) => d.travelStart)).toEqual(['2026-11-20'])
  })

  it('retires finds that stop appearing', async () => {
    const later = new Date(NOW.getTime() + 11 * 86_400_000)
    const r = await runHotelDiscovery(db, userId, { now: later, apiKey: 'k', fetch: respond([]) }, LIMITS)
    expect(r.retired).toBeGreaterThan(0)
    const live = await db
      .select()
      .from(deals)
      .where(and(eq(deals.verificationMethod, HOTEL_METHOD), isNull(deals.archivedAt)))
    expect(live).toHaveLength(0)
  })

  it('searches several places at once in one run', async () => {
    const calls: Request[] = []
    const r = await runHotelDiscovery(db, userId, { now: NOW, apiKey: 'k', fetch: respond([], calls) }, { maxCalls: 8, timeBudgetMs: 60_000 })
    expect(r.calls).toBe(8)
    expect(new Set(calls.map((c) => new URL(c.url).searchParams.get('location'))).size).toBe(8)
    // The next run continues where this one stopped.
    const next: Request[] = []
    await runHotelDiscovery(db, userId, { now: NOW, apiKey: 'k', fetch: respond([], next) }, LIMITS)
    expect(new URL(next[0]!.url).searchParams.get('location')).toBe(hotelPlaces([])[8]!.label)
  })

  it('treats an unknown place as an empty answer, not a failure', async () => {
    const r = await runHotelDiscovery(db, userId, { now: NOW, apiKey: 'k', fetch: respond([], [], 400) }, LIMITS)
    expect(r.errors).toEqual([])
    const [job] = await db.select().from(searchJobs)
    expect(job?.status).toBe('succeeded')
    expect(job?.params).toMatchObject({ locationNotFound: true })
  })

  it('moves to the next place each run and stops at the daily cap', async () => {
    const calls: Request[] = []
    await runHotelDiscovery(db, userId, { now: NOW, apiKey: 'k', fetch: respond([], calls) }, LIMITS)
    await runHotelDiscovery(db, userId, { now: NOW, apiKey: 'k', fetch: respond([], calls) }, LIMITS)
    expect(calls.map((c) => new URL(c.url).searchParams.get('location'))).toEqual(['Tokyo, Japan', 'Maldives'])
    await db.insert(searchJobs).values({ provider: 'rooms_aero', jobType: 'hotel_discovery', status: 'succeeded', requestCount: HOTEL_DAILY_CAP, startedAt: NOW, createdAt: NOW })
    const capped = await runHotelDiscovery(db, userId, { now: NOW, apiKey: 'k', fetch: respond([], calls) }, LIMITS)
    expect(calls).toHaveLength(2)
    expect(capped.skipped.join(' ')).toMatch(/daily limit/)
  })

  it('does nothing without a key or when hotels are turned off', async () => {
    const calls: Request[] = []
    expect((await runHotelDiscovery(db, userId, { now: NOW, apiKey: null, fetch: respond([], calls) }, LIMITS)).skipped.join(' ')).toMatch(/SEATS_AERO_API_KEY/)
    await db.update(userSettings).set({ hotelDiscoveryEnabled: false }).where(eq(userSettings.userId, userId))
    expect((await runHotelDiscovery(db, userId, { now: NOW, apiKey: 'k', fetch: respond([], calls) }, LIMITS)).skipped.join(' ')).toMatch(/turned off/)
    expect(calls).toHaveLength(0)
    await db.update(userSettings).set({ hotelDiscoveryEnabled: true }).where(eq(userSettings.userId, userId))
  })
})

describe('discovery alerts', () => {
  it('sends at most three value alerts for a batch of new finds', async () => {
    const rows = Array.from({ length: 6 }, (_, i) => row(`v${i}`, `Value Hotel ${i}`, { lowest_award_standard: 20000, lowest_cash_standard: 200000 + i * 10000, cpp: 10 }))
    const r = await runHotelDiscovery(db, userId, { now: NOW, apiKey: 'k', fetch: respond(rows) }, { maxCalls: 1, timeBudgetMs: 60_000 })
    expect(r.newDeals).toBe(6)
    const deps: JobDeps = { now: NOW, sendEmail: null, appUrl: 'http://localhost:3000', keys: { seatsAero: null, serpApi: null, unsplash: null }, rssFeeds: [], fetch: respond([]) }
    await runJobs(db, deps, 'daily')
    const alerts = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.eventType, 'new_exceptional_deal')))
    expect(alerts).toHaveLength(3)
  })
})
