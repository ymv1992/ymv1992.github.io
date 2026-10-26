/** Job runner tests with an in-memory database and fake provider responses (TEST FIXTURES). */
import { beforeAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/client'
import { createTestDb } from '../test-db'
import { announcements, dataSources, deals, notifications, searchJobs, userSettings, watchlists } from '@/lib/db/schema'
import { ensureOwnerAccount } from '@/lib/data/account'
import { manualDealSchema } from '@/lib/data/deal-input'
import { createManualDeal } from '@/lib/data/deals'
import { saveDeal } from '@/lib/data/saved'
import { runJobs, type JobDeps } from '@/lib/jobs/run'
import { NOW } from '../fixtures'

let db: AppDb
let userId: string
const sent: string[] = []

function deps(overrides: Partial<JobDeps> = {}): JobDeps {
  return {
    now: NOW,
    sendEmail: async (_to, subject) => {
      sent.push(subject)
      return { ok: true }
    },
    appUrl: 'http://localhost:3000',
    keys: { seatsAero: null, serpApi: null, unsplash: null },
    rssFeeds: [],
    fetch: (async () => new Response('{}', { status: 500 })) as typeof fetch,
    ...overrides,
  }
}

beforeAll(async () => {
  db = await createTestDb()
  userId = await ensureOwnerAccount(db, 'owner@example.com')
  // No quiet hours in tests; email on.
  const [s] = await db.select().from(userSettings).where(eq(userSettings.userId, userId))
  await db
    .update(userSettings)
    .set({ emailEnabled: true, notificationEmail: 'owner@example.com', alertPrefs: { ...s!.alertPrefs!, quietHoursStart: null, quietHoursEnd: null } })
    .where(eq(userSettings.userId, userId))
}, 60_000)

describe('deadline reminders', () => {
  it('sends the most recent due reminder once and skips older ones', async () => {
    const input = manualDealSchema.parse({
      kind: 'flight',
      destCity: 'Tokyo',
      destAirport: 'HND',
      originAirport: 'LAX',
      providerName: 'Deadline Air (test)',
      programId: 'united',
      programPoints: '70000',
      mandatoryCashUsd: '50',
      comparableCashUsd: '4000',
      travelStart: '2026-12-20',
      cabin: 'business',
      deadlineType: 'confirmed',
      deadlineAt: new Date(NOW.getTime() + 5 * 3_600_000).toISOString(),
      deadlineSource: 'Test fixture promotion page',
      verifiedNow: 'on',
      availability: 'available',
    })
    const { id } = await createManualDeal(db, userId, input, NOW)
    await saveDeal(db, userId, id, { programPoints: 70000, chasePoints: 70000, mandatoryCashUsd: 50, comparableCashUsd: 4000, cpp: 5.6 }, [], NOW)
    await runJobs(db, deps(), 'frequent')
    const rows = await db.select().from(notifications).where(and(eq(notifications.dealId, id), eq(notifications.eventType, 'deadline_reminder')))
    expect(rows.filter((r) => r.status === 'sent').map((r) => r.dedupeKey)).toEqual([`deadline_reminder|deal:${id}|6h`])
    expect(rows.filter((r) => r.status === 'skipped')).toHaveLength(3)
    const before = sent.length
    await runJobs(db, deps(), 'frequent')
    const again = await db.select().from(notifications).where(and(eq(notifications.dealId, id), eq(notifications.eventType, 'deadline_reminder')))
    expect(again).toHaveLength(rows.length)
    expect(sent.length).toBe(before)
  })
})

describe('watch checks', () => {
  it('records seats.aero observations, notifies once, and logs the request', async () => {
    await db.insert(watchlists).values({ userId, kind: 'route', label: 'LAX–NRT business', origins: ['LAX'], destinations: ['NRT'], cabin: 'business', provider: 'seats_aero', autoCheckSupported: true })
    const fixture = {
      data: [
        {
          ID: 'fx-1',
          Route: { OriginAirport: 'LAX', DestinationAirport: 'NRT' },
          Date: '2026-12-05',
          Source: 'united',
          JAvailable: true,
          JMileageCostRaw: 88000,
          JTotalTaxes: 5600,
          TaxesCurrency: 'USD',
          JAirlines: 'NH',
          UpdatedAt: '2026-10-18T09:00:00Z',
        },
      ],
    }
    const fakeFetch = (async () => new Response(JSON.stringify(fixture), { status: 200 })) as typeof fetch
    const summary = await runJobs(db, deps({ keys: { seatsAero: 'k', serpApi: null, unsplash: null }, fetch: fakeFetch }), 'frequent')
    expect(summary.watchChecks).toBe(1)
    const [deal] = await db.select().from(deals).where(eq(deals.sourceRef, 'fx-1'))
    expect(deal?.sourceKind).toBe('api')
    expect(deal?.lastVerifiedAt?.toISOString()).toBe('2026-10-18T09:00:00.000Z')
    const notes = await db.select().from(notifications).where(eq(notifications.eventType, 'availability_observed'))
    expect(notes).toHaveLength(1)
    const jobs = await db.select().from(searchJobs).where(eq(searchJobs.provider, 'seats_aero'))
    expect(jobs.some((j) => j.status === 'succeeded' && j.requestCount === 1)).toBe(true)
    // Not due again until the refresh interval passes.
    const second = await runJobs(db, deps({ keys: { seatsAero: 'k', serpApi: null, unsplash: null }, fetch: fakeFetch }), 'frequent')
    expect(second.watchChecks).toBe(0)
  })

  it('skips checks when the daily quota is exhausted', async () => {
    await db.update(dataSources).set({ dailyQuota: 0 }).where(eq(dataSources.id, 'seats_aero'))
    await db.update(watchlists).set({ lastCheckedAt: null })
    const summary = await runJobs(db, deps({ keys: { seatsAero: 'k', serpApi: null, unsplash: null } }), 'frequent')
    expect(summary.watchChecks).toBe(0)
    const skipped = await db.select().from(searchJobs).where(eq(searchJobs.status, 'skipped_quota'))
    expect(skipped.length).toBeGreaterThan(0)
  })

  it('reports a missing API key instead of failing', async () => {
    const summary = await runJobs(db, deps(), 'frequent')
    expect(summary.skipped.join(' ')).toMatch(/SEATS_AERO_API_KEY/)
  })
})

describe('RSS ingest', () => {
  it('stores matching announcements once', async () => {
    const xml = `<rss><channel><item><title>Chase Ultimate Rewards transfer bonus to Example (fixture)</title><link>https://example.com/fixture-bonus</link></item><item><title>Unrelated</title><link>https://example.com/x</link></item></channel></rss>`
    const fakeFetch = (async () => new Response(xml, { status: 200 })) as typeof fetch
    const s1 = await runJobs(db, deps({ rssFeeds: ['https://example.com/feed'], fetch: fakeFetch }), 'daily')
    const s2 = await runJobs(db, deps({ rssFeeds: ['https://example.com/feed'], fetch: fakeFetch }), 'daily')
    expect(s1.announcements).toBe(1)
    expect(s2.announcements).toBe(0)
    expect(await db.select().from(announcements)).toHaveLength(1)
  })
})
