import { beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createPgliteDb, type AppDb } from '@/lib/db/client'
import { deals, notifications, transferPartners } from '@/lib/db/schema'
import { ensureOwnerAccount, loadAccount } from '@/lib/data/account'
import { manualDealSchema } from '@/lib/data/deal-input'
import { archiveExpiredDeals, createManualDeal, markVerified, priceHistory } from '@/lib/data/deals'
import { dismissedDealIds, recordFeedback, undoFeedback } from '@/lib/data/feedback'
import { handledReminderOffsets, notify, recordSkippedReminders, type DeliveryConfig } from '@/lib/data/notifications'
import { createCollection, listCollections, listSaved, saveDeal, setCollections, unsaveDeal } from '@/lib/data/saved'
import { buildDemoDeals, removeDemoData, seedDemoData } from '@/lib/db/seed-demo'
import { NOW } from '../fixtures'

let db: AppDb
let userId: string

const baseInput = {
  kind: 'flight',
  destCity: 'Tokyo',
  destAirport: 'HND',
  originAirport: 'LAX',
  providerName: 'Example Air (test)',
  programId: 'aeroplan',
  programPoints: '75000',
  mandatoryCashUsd: '180',
  comparableCashUsd: '5200',
  travelStart: '2026-12-01',
  cabin: 'business',
  seatType: 'lie_flat',
  verifiedNow: 'on',
  availability: 'available',
}

beforeAll(async () => {
  db = await createPgliteDb()
  userId = await ensureOwnerAccount(db, 'Owner@Example.com')
}, 60_000)

describe('reference data and account bootstrap', () => {
  it('seeds transfer partners as research data, not verified', async () => {
    const rows = await db.select().from(transferPartners)
    expect(rows.length).toBeGreaterThanOrEqual(14)
    expect(rows.every((r) => r.verificationStatus === 'research_seed')).toBe(true)
    const hyatt = rows.find((r) => r.id === 'hyatt')!
    expect(hyatt.cardRatioOverrides.sapphire_preferred).toEqual({ chase: 4, partner: 3 })
    expect(hyatt.cardRatioOverrides.sapphire_reserve).toBeUndefined()
  })

  it('creates the owner account once with defaults', async () => {
    expect(await ensureOwnerAccount(db, 'owner@example.com')).toBe(userId)
    const acct = await loadAccount(db, userId)
    expect(acct.wallet.chaseBalance).toBe(150_000)
    expect(acct.profile.homeAirports).toEqual(['SAN', 'LAX', 'SNA', 'ONT', 'BUR'])
    expect((await listCollections(db, userId)).map((c) => c.name)).toContain('Overwater Villas')
  })
})

describe('manual deals', () => {
  it('validates input and rejects unsafe URLs', () => {
    const bad = manualDealSchema.safeParse({ ...baseInput, sourceUrl: 'javascript:alert(1)' })
    expect(bad.success).toBe(false)
    const noCabin = manualDealSchema.safeParse({ ...baseInput, cabin: '' })
    expect(noCabin.success).toBe(false)
  })

  it('prevents duplicates and records price history on repeat observations', async () => {
    const input = manualDealSchema.parse(baseInput)
    const first = await createManualDeal(db, userId, input, NOW)
    expect(first.isNew).toBe(true)
    const cheaper = manualDealSchema.parse({ ...baseInput, programPoints: '65000' })
    const second = await createManualDeal(db, userId, cheaper, new Date(NOW.getTime() + 3_600_000))
    expect(second.isNew).toBe(false)
    expect(second.id).toBe(first.id)
    expect(second.change.kind).toBe('drop')
    expect(second.change.significant).toBe(true)
    expect(await priceHistory(db, first.id)).toHaveLength(2)
    const [row] = await db.select().from(deals).where(eq(deals.id, first.id))
    expect(row!.destCountry).toBe('Japan')
    expect(row!.destRegion).toBe('asia')
    expect(row!.lastVerifiedAt).not.toBeNull()
  })

  it('archives deals that the owner marks unavailable and expired deals', async () => {
    const input = manualDealSchema.parse({ ...baseInput, travelStart: '2026-11-15', programPoints: '80000' })
    const { id } = await createManualDeal(db, userId, input, NOW)
    await markVerified(db, id, false, NOW)
    const [row] = await db.select().from(deals).where(eq(deals.id, id))
    expect(row!.archivedAt).not.toBeNull()
    expect(row!.archiveReason).toBe('availability_disappeared')

    const past = manualDealSchema.parse({ ...baseInput, travelStart: '2026-10-01', providerName: 'Past Air (test)' })
    const p = await createManualDeal(db, userId, past, NOW)
    const archived = await archiveExpiredDeals(db, NOW)
    expect(archived).toContain(p.id)
  })
})

describe('saved deals', () => {
  it('saves once, keeps the original snapshot, organises and removes', async () => {
    const input = manualDealSchema.parse({ ...baseInput, destAirport: 'KIX', destCity: 'Osaka' })
    const { id: dealId } = await createManualDeal(db, userId, input, NOW)
    const cols = await listCollections(db, userId)
    const business = cols.find((c) => c.name === 'Business Class')!
    const snapshot = { programPoints: 75_000, chasePoints: 75_000, mandatoryCashUsd: 180, comparableCashUsd: 5_200, cpp: 6.69 }
    const savedId = await saveDeal(db, userId, dealId, snapshot, [business.id], NOW)
    const again = await saveDeal(db, userId, dealId, { ...snapshot, programPoints: 1 }, [], NOW)
    expect(again).toBe(savedId)
    let saved = (await listSaved(db, userId)).find((s) => s.id === savedId)!
    expect(saved.originalProgramPoints).toBe(75_000)
    expect(saved.collectionIds).toEqual([business.id])

    const custom = await createCollection(db, userId, 'Honeymoon ideas')
    await expect(createCollection(db, userId, 'Honeymoon ideas')).rejects.toThrow(/already exists/)
    await setCollections(db, userId, savedId, [custom, business.id])
    saved = (await listSaved(db, userId)).find((s) => s.id === savedId)!
    expect(saved.collectionIds.sort()).toEqual([custom, business.id].sort())

    await unsaveDeal(db, userId, dealId)
    expect((await listSaved(db, userId)).find((s) => s.id === savedId)).toBeUndefined()
  })

  it('ignores collections owned by someone else', async () => {
    const other = await ensureOwnerAccount(db, 'someone-else@example.com')
    const theirs = (await listCollections(db, other))[0]!
    const input = manualDealSchema.parse({ ...baseInput, destAirport: 'NRT', destCity: 'Narita' })
    const { id: dealId } = await createManualDeal(db, userId, input, NOW)
    const savedId = await saveDeal(db, userId, dealId, { programPoints: 1, chasePoints: 1, mandatoryCashUsd: 0, comparableCashUsd: 0, cpp: null }, [theirs.id], NOW)
    expect((await listSaved(db, userId)).find((s) => s.id === savedId)!.collectionIds).toEqual([])
  })

  it('makes passes recoverable with undo', async () => {
    const input = manualDealSchema.parse({ ...baseInput, destAirport: 'ICN', destCity: 'Seoul' })
    const { id: dealId } = await createManualDeal(db, userId, input, NOW)
    const fb = await recordFeedback(db, userId, dealId, 'pass')
    expect((await dismissedDealIds(db, userId)).has(dealId)).toBe(true)
    await undoFeedback(db, userId, fb)
    expect((await dismissedDealIds(db, userId)).has(dealId)).toBe(false)
  })
})

describe('notifications', () => {
  const cfg = (sent: string[]): DeliveryConfig => ({
    prefs: {
      enabledTypes: ['saved_price_drop', 'deadline_reminder'],
      minCpp: null,
      maxPoints: null,
      maxCashUsd: null,
      destinations: [],
      cabins: [],
      hotelCategories: [],
      travelFrom: null,
      travelTo: null,
      urgentOnly: false,
      frequency: 'instant',
      quietHoursStart: null,
      quietHoursEnd: null,
      timeZone: 'UTC',
    },
    emailEnabled: true,
    emailTo: 'owner@example.com',
    sendEmail: async (_to, subject) => {
      sent.push(subject)
      return { ok: true }
    },
    appUrl: 'http://localhost:3000',
  })

  it('delivers an event once even if it is raised repeatedly', async () => {
    const sent: string[] = []
    const event = { type: 'saved_price_drop' as const, dealId: null, discriminator: 'test-points=60000', title: 'Price drop', body: 'Now 60,000', link: '/saved' }
    const a = await notify(db, userId, event, cfg(sent), NOW)
    const b = await notify(db, userId, event, cfg(sent), NOW)
    expect(a.created).toBe(true)
    expect(b.created).toBe(false)
    expect(sent).toHaveLength(1)
  })

  it('tracks handled and skipped reminder offsets', async () => {
    const input = manualDealSchema.parse({ ...baseInput, destAirport: 'TPE', destCity: 'Taipei' })
    const { id: dealId } = await createManualDeal(db, userId, input, NOW)
    await recordSkippedReminders(db, userId, dealId, ['7d', '3d'], NOW)
    await notify(db, userId, { type: 'deadline_reminder', dealId, discriminator: '24h', title: 't', body: 'b', link: '/' }, cfg([]), NOW)
    expect([...(await handledReminderOffsets(db, userId, dealId))].sort()).toEqual(['24h', '3d', '7d'])
    const rows = await db.select().from(notifications).where(eq(notifications.dealId, dealId))
    expect(rows.filter((r) => r.status === 'skipped')).toHaveLength(2)
  })
})

describe('demo data', () => {
  it('labels every demo record and can be removed cleanly', async () => {
    const built = buildDemoDeals(NOW)
    expect(built.every((d) => d.sourceKind === 'demo' && d.dedupeKey.startsWith('demo:'))).toBe(true)
    expect(built.every((d) => /fictional/i.test(d.providerName))).toBe(true)
    const n = await seedDemoData(db, NOW)
    expect(n).toBe(built.length)
    expect(await seedDemoData(db, NOW)).toBe(0)
    await removeDemoData(db)
    const left = await db.select().from(deals).where(eq(deals.sourceKind, 'demo'))
    expect(left).toHaveLength(0)
  })
})
