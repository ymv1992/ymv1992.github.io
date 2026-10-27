/** Automatic discovery tests with an in-memory database and fake seats.aero responses (TEST FIXTURES). */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/client'
import { createTestDb } from '../test-db'
import { appState, deals, notifications, searchJobs, travelProfiles, userSettings } from '@/lib/db/schema'
import { ensureOwnerAccount } from '@/lib/data/account'
import { DISCOVERY_DAILY_CAP, DISCOVERY_METHOD, discoveryTasks, dreamAirports, pickCheapest, runDiscovery } from '@/lib/jobs/discovery'
import { runJobs, type JobDeps } from '@/lib/jobs/run'
import { itemToDealColumns, type SeatsAeroItem } from '@/lib/providers/seats-aero'
import { NOW } from '../fixtures'

let db: AppDb
let userId: string

function item(id: string, origin: string, dest: string, date: string, miles: number, extra: Partial<SeatsAeroItem> = {}): SeatsAeroItem {
  return {
    ID: id,
    Route: { OriginAirport: origin, DestinationAirport: dest },
    Date: date,
    Source: 'united',
    JAvailable: true,
    JMileageCostRaw: miles,
    JTotalTaxes: 5600,
    TaxesCurrency: 'USD',
    JAirlines: 'UA',
    UpdatedAt: '2026-10-18T09:00:00Z',
    ...extra,
  }
}

function respond(items: SeatsAeroItem[], calls: string[] = []) {
  return (async (url: string | URL | Request) => {
    calls.push(String(url))
    return new Response(JSON.stringify({ data: items, count: items.length, hasMore: false }), { status: 200 })
  }) as typeof fetch
}

const LIMITS = { maxCalls: 1, timeBudgetMs: 60_000 }

async function resetCursor() {
  await db.delete(appState).where(eq(appState.key, 'discovery:cursor'))
}

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
  await resetCursor()
})

describe('discovery planning', () => {
  it('keeps the cheapest date per city, cabin and month, preferring nonstop on ties', () => {
    const cols = [
      item('a', 'LAX', 'HND', '2026-11-03', 88000),
      item('b', 'LAX', 'HND', '2026-11-09', 75000, { JDirect: false }),
      item('c', 'SAN', 'HND', '2026-11-20', 75000, { JDirect: true }),
      item('d', 'LAX', 'HND', '2026-12-01', 90000),
    ].map((i) => itemToDealColumns(i, 'business')!)
    const kept = pickCheapest(cols)
    expect(kept.map((k) => k.sourceRef).sort()).toEqual(['c', 'd'])
  })

  it('matches dream destinations only to clear airports not already searched', () => {
    expect(dreamAirports(['ZQN', 'Tokyo', 'Atlantis', ''])).toEqual(['ZQN'])
  })

  it('searches dream destinations first in each cycle', () => {
    const tasks = discoveryTasks(['business'], ['ZQN'])
    expect(tasks[0]).toMatchObject({ groupId: 'dreams', airports: ['ZQN'], cabin: 'business', window: 0 })
    expect(tasks.length).toBe(11 * 3)
  })
})

describe('runDiscovery', () => {
  it('searches from the home airports and stores the cheapest finds', async () => {
    const calls: string[] = []
    const fetch = respond(
      [
        item('fx-1', 'LAX', 'NRT', '2026-11-05', 88000),
        item('fx-2', 'LAX', 'NRT', '2026-11-12', 70000),
        item('fx-3', 'SAN', 'HND', '2026-12-02', 75000),
        item('fx-4', 'SEA', 'NRT', '2026-11-06', 50000),
        item('fx-5', 'LAX', 'NRT', '2026-11-07', 60000, { Source: 'not_a_chase_partner' }),
      ],
      calls,
    )
    const r = await runDiscovery(db, userId, { now: NOW, apiKey: 'k', fetch }, LIMITS)
    expect(r.calls).toBe(1)
    expect(r.newDeals).toBe(2)
    const url = new URL(calls[0]!)
    expect(url.pathname).toBe('/partnerapi/search')
    expect(url.searchParams.get('origin_airport')).toBe('SAN,LAX,SNA,ONT,BUR')
    expect(url.searchParams.get('destination_airport')).toBe('NRT,HND,KIX,ICN,TPE,HKG')
    expect(url.searchParams.get('cabin')).toBe('business')
    const found = await db.select().from(deals).where(eq(deals.verificationMethod, DISCOVERY_METHOD))
    expect(found.map((d) => d.sourceRef).sort()).toEqual(['fx-2', 'fx-3'])
    expect(found.every((d) => d.sourceKind === 'api' && d.availability === 'available')).toBe(true)
    const [job] = await db.select().from(searchJobs).where(eq(searchJobs.jobType, 'discovery'))
    expect(job).toMatchObject({ provider: 'seats_aero', status: 'succeeded', requestCount: 1 })
  })

  it('moves a find to History when a complete answer no longer includes it', async () => {
    await runDiscovery(db, userId, { now: NOW, apiKey: 'k', fetch: respond([item('fx-3', 'SAN', 'HND', '2026-12-02', 75000)]) }, LIMITS)
    const [gone] = await db.select().from(deals).where(eq(deals.sourceRef, 'fx-2'))
    expect(gone).toMatchObject({ availability: 'unavailable', archiveReason: 'availability_disappeared' })
    expect(gone?.archivedAt).not.toBeNull()
    const [kept] = await db.select().from(deals).where(eq(deals.sourceRef, 'fx-3'))
    expect(kept?.availability).toBe('available')
  })

  it('does not mark anything gone when the answer was cut off', async () => {
    await runDiscovery(db, userId, { now: NOW, apiKey: 'k', fetch: respond([item('fx-3', 'SAN', 'HND', '2026-12-02', 75000)]) }, LIMITS)
    await resetCursor()
    const truncated = (async () =>
      new Response(JSON.stringify({ data: [item('fx-9', 'LAX', 'ICN', '2026-11-15', 80000)], hasMore: true }), { status: 200 })) as unknown as typeof fetch
    const r = await runDiscovery(db, userId, { now: NOW, apiKey: 'k', fetch: truncated }, LIMITS)
    expect(r.markedUnavailable).toBe(0)
    const [still] = await db.select().from(deals).where(eq(deals.sourceRef, 'fx-3'))
    expect(still?.availability).toBe('available')
  })

  it('moves on to the next search each run', async () => {
    const calls: string[] = []
    await runDiscovery(db, userId, { now: NOW, apiKey: 'k', fetch: respond([], calls) }, LIMITS)
    await runDiscovery(db, userId, { now: NOW, apiKey: 'k', fetch: respond([], calls) }, LIMITS)
    // One cabin across all regions first: Japan/Korea, then Western Europe.
    expect(calls.map((c) => new URL(c).searchParams.get('cabin'))).toEqual(['business', 'business'])
    expect(calls.map((c) => new URL(c).searchParams.get('destination_airport')?.split(',')[0])).toEqual(['NRT', 'LHR'])
  })

  it('stops at the daily cap', async () => {
    await db.insert(searchJobs).values({ provider: 'seats_aero', jobType: 'discovery', status: 'succeeded', requestCount: DISCOVERY_DAILY_CAP, startedAt: NOW, createdAt: NOW })
    const calls: string[] = []
    const r = await runDiscovery(db, userId, { now: NOW, apiKey: 'k', fetch: respond([], calls) }, { maxCalls: 5, timeBudgetMs: 60_000 })
    expect(calls).toHaveLength(0)
    expect(r.skipped.join(' ')).toMatch(/daily limit/)
  })

  it('leaves room for watches and manual searches in the shared quota', async () => {
    await db.insert(searchJobs).values({ provider: 'seats_aero', jobType: 'watch_check', status: 'succeeded', requestCount: 800, startedAt: NOW, createdAt: NOW })
    const calls: string[] = []
    await runDiscovery(db, userId, { now: NOW, apiKey: 'k', fetch: respond([], calls) }, { maxCalls: 5, timeBudgetMs: 60_000 })
    expect(calls).toHaveLength(0)
  })

  it('does nothing without a key or when turned off', async () => {
    const calls: string[] = []
    const noKey = await runDiscovery(db, userId, { now: NOW, apiKey: null, fetch: respond([], calls) }, LIMITS)
    expect(noKey.skipped.join(' ')).toMatch(/SEATS_AERO_API_KEY/)
    await db.update(userSettings).set({ discoveryEnabled: false }).where(eq(userSettings.userId, userId))
    const off = await runDiscovery(db, userId, { now: NOW, apiKey: 'k', fetch: respond([], calls) }, LIMITS)
    expect(off.skipped.join(' ')).toMatch(/turned off/)
    expect(calls).toHaveLength(0)
    await db.update(userSettings).set({ discoveryEnabled: true }).where(eq(userSettings.userId, userId))
  })
})

describe('discovery alerts', () => {
  it('sends one dream-destination alert per city, for the cheapest find', async () => {
    await db.update(travelProfiles).set({ dreamDestinations: ['Queenstown'] }).where(eq(travelProfiles.userId, userId))
    const fetch = respond([item('q-1', 'LAX', 'ZQN', '2026-11-10', 95000), item('q-2', 'SFO', 'ZQN', '2026-11-11', 60000), item('q-3', 'LAX', 'ZQN', '2026-12-10', 85000)])
    const r = await runDiscovery(db, userId, { now: NOW, apiKey: 'k', fetch }, LIMITS)
    expect(r.newDeals).toBe(2)
    const deps: JobDeps = {
      now: NOW,
      sendEmail: null,
      appUrl: 'http://localhost:3000',
      keys: { seatsAero: 'k', serpApi: null, unsplash: null },
      rssFeeds: [],
      fetch: respond([]),
    }
    await runJobs(db, deps, 'daily')
    const alerts = await db.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.eventType, 'dream_destination_match')))
    expect(alerts).toHaveLength(1)
    const [cheapest] = await db.select().from(deals).where(eq(deals.sourceRef, 'q-3'))
    expect(alerts[0]?.dealId).toBe(cheapest?.id)
  })
})
