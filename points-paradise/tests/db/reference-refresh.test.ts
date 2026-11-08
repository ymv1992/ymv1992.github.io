/** Reference data stays current between releases without overwriting the owner's own edits; card benefits stay in step with earning rates. */
import { beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/client'
import { transferPartners, transferPromotions } from '@/lib/db/schema'
import { ensureReferenceData, PARTNER_SEED, PROMOTION_SEED } from '@/lib/db/seed-reference'
import { partnerUpdateSchema, updatePartner } from '@/lib/data/transfers'
import { BENEFITS_CHECKED, CARD_BENEFITS } from '@/lib/domain/card-benefits'
import { CARD_TYPE_IDS } from '@/lib/domain/constants'
import { FLIGHT_EARN } from '@/lib/domain/earning'
import { createTestDb } from '../test-db'

let db: AppDb
const partner = async (id: string) => (await db.select().from(transferPartners).where(eq(transferPartners.id, id)))[0]!
const promo = async (id: string) => (await db.select().from(transferPromotions).where(eq(transferPromotions.id, id)))[0]!

beforeAll(async () => {
  db = await createTestDb()
}, 60_000)

describe('reference data refresh', () => {
  it('brings research-based partners back in line with the latest release', async () => {
    // As if an older release had stored Hyatt at 1:1 for every card.
    await db.update(transferPartners).set({ cardRatioOverrides: {}, restrictions: 'old text' }).where(eq(transferPartners.id, 'hyatt'))
    await ensureReferenceData(db)
    const hyatt = await partner('hyatt')
    const seed = PARTNER_SEED.find((p) => p.id === 'hyatt')!
    expect(hyatt.cardRatioOverrides).toEqual(seed.cardRatioOverrides)
    expect(hyatt.restrictions).toBe(seed.restrictions)
    expect(hyatt.verificationStatus).toBe('research_seed')
  })

  it('never overwrites a partner the owner edited or verified', async () => {
    const input = partnerUpdateSchema.parse({ baseRatio: { chase: 1, partner: 1 }, cardRatioOverrides: {}, minTransfer: 1000, transferIncrement: 1000, processingTime: 'Instant for me', typicalValueCents: '', active: true, notes: 'My note', markVerified: false })
    await updatePartner(db, 'ihg', input)
    expect((await partner('ihg')).verificationStatus).toBe('owner_edited')
    await ensureReferenceData(db)
    expect(await partner('ihg')).toMatchObject({ processingTime: 'Instant for me', notes: 'My note', verificationStatus: 'owner_edited' })
    await updatePartner(db, 'marriott', { ...input, markVerified: true })
    await updatePartner(db, 'marriott', { ...input, processingTime: 'Changed later', markVerified: false })
    // Editing a verified partner again keeps it verified.
    expect((await partner('marriott')).verificationStatus).toBe('owner_verified')
  })

  it('includes the reported November 2026 bonuses with their Eastern-time windows', async () => {
    const byPartner = (id: string) => PROMOTION_SEED.find((p) => p.partnerId === id && p.startsAt?.toISOString() === '2026-11-01T04:00:00.000Z')!
    expect(byPartner('ihg')).toMatchObject({ bonusPercent: 80 })
    for (const id of ['british_airways', 'iberia', 'aer_lingus']) expect(byPartner(id)).toMatchObject({ bonusPercent: 30, endsAt: new Date('2026-12-02T04:59:00Z') })
    expect(byPartner('wyndham')).toMatchObject({ bonusPercent: 30, endsAt: new Date('2026-12-04T04:59:00Z') })
    const ids = PROMOTION_SEED.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const p of PROMOTION_SEED) expect(PARTNER_SEED.map((x) => x.id)).toContain(p.partnerId)
  })

  it('adds new bonuses, refreshes reported ones, and leaves ones the owner verified alone', async () => {
    const ihg = PROMOTION_SEED.find((p) => p.partnerId === 'ihg')!
    expect(await promo(ihg.id!)).toMatchObject({ bonusPercent: 80, verificationStatus: 'reported' })
    await db.update(transferPromotions).set({ endsAt: new Date('2026-11-20T00:00:00Z') }).where(eq(transferPromotions.id, ihg.id!))
    await ensureReferenceData(db)
    expect((await promo(ihg.id!)).endsAt?.toISOString()).toBe(ihg.endsAt!.toISOString())
    await db.update(transferPromotions).set({ verificationStatus: 'owner_verified', endsAt: new Date('2026-12-10T00:00:00Z') }).where(eq(transferPromotions.id, ihg.id!))
    await ensureReferenceData(db)
    expect((await promo(ihg.id!)).endsAt?.toISOString()).toBe('2026-12-10T00:00:00.000Z')
  })
})

describe('card benefits', () => {
  it('give earning, perks and sources for each card they cover, with a check date', () => {
    expect(BENEFITS_CHECKED).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    for (const [card, b] of Object.entries(CARD_BENEFITS)) {
      expect(CARD_TYPE_IDS).toContain(card)
      expect(b!.earning.length, card).toBeGreaterThan(0)
      expect(b!.sources.length, card).toBeGreaterThan(0)
      for (const s of b!.sources) expect(s.url).toMatch(/^https:\/\//)
    }
  })

  it('match the earning rates used for cash fares', () => {
    const rate = (card: keyof typeof CARD_BENEFITS, match: RegExp) => Number(CARD_BENEFITS[card]!.earning.find((e) => match.test(e.what))!.rate.replace('×', ''))
    for (const card of ['sapphire_preferred', 'sapphire_reserve', 'sapphire_reserve_business'] as const) {
      expect(rate(card, /^Chase Travel/)).toBe(FLIGHT_EARN[card].chaseTravel)
      expect(rate(card, /booked directly/)).toBe(FLIGHT_EARN[card].direct)
    }
  })
})
