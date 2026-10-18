import { asc, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { CARD_TYPE_IDS } from '../domain/constants'
import type { AppDb } from '../db/client'
import { partnerFromRow, promotionFromRow } from '../db/mappers'
import { transferPartners, transferPromotions } from '../db/schema'

export async function listPartners(db: AppDb) {
  return (await db.select().from(transferPartners).orderBy(desc(transferPartners.active), asc(transferPartners.type), asc(transferPartners.name))).map((r) => ({
    ...partnerFromRow(r),
    typicalValueCents: r.typicalValueCents,
    updatedAt: r.updatedAt,
  }))
}

export async function listPromotions(db: AppDb) {
  return (await db.select().from(transferPromotions).orderBy(desc(transferPromotions.startsAt))).map(promotionFromRow)
}

const httpUrl = z
  .string()
  .trim()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), 'Must be an http(s) link')

export const promotionInputSchema = z
  .object({
    partnerId: z.string().min(1).max(60),
    bonusPercent: z.coerce.number().gt(0).max(300),
    startsAt: z.coerce.date(),
    endsAt: z.preprocess((v) => (v === '' || v == null ? null : v), z.coerce.date().nullable()),
    endsAtTimezone: z.preprocess((v) => (v === '' ? null : v), z.string().max(60).nullable().default('America/New_York')),
    eligibleCardTypes: z.preprocess(
      (v) => (Array.isArray(v) ? (v.length ? v : null) : typeof v === 'string' && v ? [v] : null),
      z.array(z.enum(CARD_TYPE_IDS)).nullable(),
    ),
    isTargeted: z.preprocess((v) => v === true || v === 'on' || v === 'true', z.boolean()),
    eligibility: z.preprocess((v) => (v === '' ? null : v), z.string().max(500).nullable().default(null)),
    sourceUrl: z.preprocess((v) => (v === '' ? null : v), httpUrl.nullable()),
    sourceKind: z.enum(['official', 'announcement', 'manual']).default('manual'),
    verifiedOnChase: z.preprocess((v) => v === true || v === 'on' || v === 'true', z.boolean()),
    notes: z.preprocess((v) => (v === '' ? null : v), z.string().max(1000).nullable().default(null)),
  })
  .refine((v) => !v.endsAt || v.endsAt > v.startsAt, { path: ['endsAt'], message: 'End must be after start' })

export type PromotionInput = z.infer<typeof promotionInputSchema>

export async function createPromotion(db: AppDb, input: PromotionInput, now = new Date()): Promise<string> {
  const [partner] = await db.select({ id: transferPartners.id }).from(transferPartners).where(eq(transferPartners.id, input.partnerId))
  if (!partner) throw new Error('Unknown transfer partner')
  const [row] = await db
    .insert(transferPromotions)
    .values({
      partnerId: input.partnerId,
      bonusPercent: input.bonusPercent,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      endsAtTimezone: input.endsAtTimezone,
      eligibleCardTypes: input.eligibleCardTypes,
      isTargeted: input.isTargeted,
      eligibility: input.eligibility,
      sourceUrl: input.sourceUrl,
      sourceKind: input.verifiedOnChase ? 'official' : input.sourceKind,
      verificationStatus: input.verifiedOnChase ? 'owner_verified' : 'reported',
      lastVerifiedAt: input.verifiedOnChase ? now : null,
      notes: input.notes,
    })
    .returning({ id: transferPromotions.id })
  return row!.id
}

export async function deletePromotion(db: AppDb, id: string): Promise<void> {
  await db.delete(transferPromotions).where(eq(transferPromotions.id, id))
}

export async function verifyPromotion(db: AppDb, id: string, now = new Date()): Promise<void> {
  await db
    .update(transferPromotions)
    .set({ verificationStatus: 'owner_verified', lastVerifiedAt: now })
    .where(eq(transferPromotions.id, id))
}

const ratioSchema = z.object({ chase: z.coerce.number().int().min(1).max(100), partner: z.coerce.number().int().min(1).max(100) })

export const partnerUpdateSchema = z.object({
  baseRatio: ratioSchema,
  cardRatioOverrides: z.partialRecord(z.enum(CARD_TYPE_IDS), ratioSchema),
  minTransfer: z.coerce.number().int().min(1).max(1_000_000),
  transferIncrement: z.coerce.number().int().min(1).max(1_000_000),
  processingTime: z.string().trim().min(1).max(200),
  typicalValueCents: z.preprocess((v) => (v === '' || v == null ? null : v), z.coerce.number().min(0).max(20).nullable()),
  active: z.preprocess((v) => v === true || v === 'on' || v === 'true', z.boolean()),
  notes: z.preprocess((v) => (v === '' ? null : v), z.string().max(2000).nullable()),
  markVerified: z.preprocess((v) => v === true || v === 'on' || v === 'true', z.boolean()),
})

export type PartnerUpdate = z.infer<typeof partnerUpdateSchema>

/** Owner edits after checking chase.com; marking verified time-stamps the record. */
export async function updatePartner(db: AppDb, id: string, input: PartnerUpdate, now = new Date()): Promise<void> {
  await db
    .update(transferPartners)
    .set({
      baseRatioChase: input.baseRatio.chase,
      baseRatioPartner: input.baseRatio.partner,
      cardRatioOverrides: input.cardRatioOverrides,
      minTransfer: input.minTransfer,
      transferIncrement: input.transferIncrement,
      processingTime: input.processingTime,
      typicalValueCents: input.typicalValueCents,
      active: input.active,
      notes: input.notes,
      ...(input.markVerified ? { verificationStatus: 'owner_verified' as const, lastVerifiedAt: now } : {}),
      updatedAt: now,
    })
    .where(eq(transferPartners.id, id))
}
