'use server'

import { eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { pointsWallets, travelProfiles, userSettings } from '@/lib/db/schema'
import { seedDemoData, removeDemoData } from '@/lib/db/seed-demo'
import { loadAccount } from '@/lib/data/account'
import { CARD_TYPE_IDS, CATEGORY_DEFS, DATE_FLEXIBILITY, TRAVEL_TAGS } from '@/lib/domain/constants'
import { getAirport } from '@/lib/geo/airports'
import { requireUserId } from '@/lib/server/session'

const categorySlugs = CATEGORY_DEFS.map((c) => c.slug) as [string, ...string[]]

const onboardingSchema = z.object({
  cardType: z.enum(CARD_TYPE_IDS),
  chaseBalance: z.coerce.number().int().min(0).max(50_000_000),
  homeAirports: z
    .array(z.string().regex(/^[A-Z]{3}$/))
    .min(1)
    .max(10)
    .refine((codes) => codes.every((c) => getAirport(c)), 'Unknown airport code'),
  maxCashUsd: z.coerce.number().min(0).max(1_000_000),
  tagPreferences: z.partialRecord(z.enum(TRAVEL_TAGS), z.union([z.literal(-1), z.literal(0), z.literal(1), z.literal(2)])),
  tripStyles: z.array(z.string().max(30)).max(10),
  dateFlexibility: z.enum(DATE_FLEXIBILITY),
  preferredCategories: z.array(z.enum(categorySlugs)).max(13),
  dreamDestinations: z.array(z.string().trim().min(1).max(60)).max(20),
  demoMode: z.boolean(),
})

export type OnboardingInput = z.infer<typeof onboardingSchema>

export async function completeOnboarding(input: OnboardingInput): Promise<{ error: string } | void> {
  const userId = await requireUserId()
  const parsed = onboardingSchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { error: issue ? `${issue.path.join('.') || 'Answer'}: ${issue.message}` : 'Please check your answers.' }
  }
  const v = parsed.data
  const db = await getDb()
  const account = await loadAccount(db, userId)
  const now = new Date()
  await db.update(pointsWallets).set({ cardType: v.cardType, chaseBalance: v.chaseBalance, updatedAt: now }).where(eq(pointsWallets.userId, userId))
  await db
    .update(travelProfiles)
    .set({
      homeAirports: v.homeAirports,
      maxCashUsd: v.maxCashUsd,
      maxPoints: v.chaseBalance,
      tagPreferences: v.tagPreferences,
      tripStyles: v.tripStyles,
      dateFlexibility: v.dateFlexibility,
      preferredCategories: v.preferredCategories,
      dreamDestinations: v.dreamDestinations,
      updatedAt: now,
    })
    .where(eq(travelProfiles.id, account.profile.id))
  await db.update(userSettings).set({ demoMode: v.demoMode, onboardingCompletedAt: now, updatedAt: now }).where(eq(userSettings.userId, userId))
  if (v.demoMode) await seedDemoData(db, now)
  else await removeDemoData(db)
  redirect('/discover')
}
