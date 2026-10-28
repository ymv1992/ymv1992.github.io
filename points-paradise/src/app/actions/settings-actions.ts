'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { pointsWallets, travelProfiles, userSettings } from '@/lib/db/schema'
import { removeDemoData, seedDemoData } from '@/lib/db/seed-demo'
import { loadAccount, setActiveProfile } from '@/lib/data/account'
import { resetPersonalization } from '@/lib/data/feedback'
import { deleteUserData } from '@/lib/data/privacy'
import { CABINS, CARD_TYPE_IDS, CATEGORY_DEFS, DATE_FLEXIBILITY, DEAL_BREAKERS, TRAVEL_TAGS } from '@/lib/domain/constants'
import { getAirport } from '@/lib/geo/airports'
import { isValidTimeZone } from '@/lib/time'
import { endSession, requireUserId } from '@/lib/server/session'
import type { FormState } from '@/components/action-form'

const bool = (v: FormDataEntryValue | null) => v === 'on' || v === 'true'
const optNum = z.preprocess((v) => (v === '' || v == null ? null : v), z.coerce.number().min(0).nullable())

function firstIssue(err: z.ZodError): string {
  const i = err.issues[0]
  return i ? `${i.path.join('.') || 'Value'}: ${i.message}` : 'Please check the form'
}

function list(v: FormDataEntryValue | null): string[] {
  return String(v ?? '')
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export async function saveWalletAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const balances: Record<string, number> = {}
  for (const [k, v] of fd.entries()) {
    if (k.startsWith('partner_') && String(v).trim() !== '') {
      const n = Number(v)
      if (!Number.isFinite(n) || n < 0 || n > 50_000_000) return { error: `Invalid balance for ${k.slice(8)}` }
      if (n > 0) balances[k.slice(8)] = Math.round(n)
    }
  }
  const parsed = z
    .object({ chaseBalance: z.coerce.number().int().min(0).max(50_000_000), cardType: z.enum(CARD_TYPE_IDS) })
    .safeParse({ chaseBalance: fd.get('chaseBalance'), cardType: fd.get('cardType') })
  if (!parsed.success) return { error: firstIssue(parsed.error) }
  const db = await getDb()
  await db.update(pointsWallets).set({ ...parsed.data, partnerBalances: balances, updatedAt: new Date() }).where(eq(pointsWallets.userId, userId))
  revalidatePath('/', 'layout')
  return { error: null, ok: 'Wallet updated — values recalculated.' }
}

const profileSchema = z.object({
  name: z.string().trim().min(1).max(60),
  homeAirports: z
    .array(z.string().regex(/^[A-Z]{3}$/, 'Use 3-letter airport codes'))
    .min(1, 'Add at least one home airport')
    .max(10)
    .refine((c) => c.every((x) => getAirport(x)), 'Unknown airport code'),
  maxCashUsd: z.coerce.number().min(0).max(1_000_000),
  maxPoints: optNum,
  tripNightsMin: optNum,
  tripNightsMax: optNum,
  maxFlightHours: optNum,
  dateFlexibility: z.enum(DATE_FLEXIBILITY),
  tagPreferences: z.partialRecord(z.enum(TRAVEL_TAGS), z.union([z.literal(-1), z.literal(0), z.literal(1), z.literal(2)])),
  tripStyles: z.array(z.string().max(30)).max(10),
  visited: z.array(z.string().max(60)).max(200),
  dreamDestinations: z.array(z.string().max(60)).max(50),
  dealBreakers: z.array(z.enum(DEAL_BREAKERS)),
  preferredCategories: z.array(z.enum(CATEGORY_DEFS.map((c) => c.slug) as [string, ...string[]])),
  preferNewPlaces: z.boolean(),
})

function profileFromForm(fd: FormData) {
  const tagPreferences: Record<string, number> = {}
  for (const t of TRAVEL_TAGS) {
    const v = fd.get(`tag_${t}`)
    if (v != null && v !== '0') tagPreferences[t] = Number(v)
  }
  return profileSchema.safeParse({
    name: fd.get('name'),
    homeAirports: list(fd.get('homeAirports')).map((s) => s.toUpperCase()),
    maxCashUsd: fd.get('maxCashUsd'),
    maxPoints: fd.get('maxPoints'),
    tripNightsMin: fd.get('tripNightsMin'),
    tripNightsMax: fd.get('tripNightsMax'),
    maxFlightHours: fd.get('maxFlightHours'),
    dateFlexibility: fd.get('dateFlexibility'),
    tagPreferences,
    tripStyles: fd.getAll('tripStyles').map(String),
    visited: list(fd.get('visited')),
    dreamDestinations: list(fd.get('dreamDestinations')),
    dealBreakers: fd.getAll('dealBreakers').map(String),
    preferredCategories: fd.getAll('preferredCategories').map(String),
    preferNewPlaces: bool(fd.get('preferNewPlaces')),
  })
}

export async function saveProfileAction(profileId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const userId = await requireUserId()
  if (!z.string().uuid().safeParse(profileId).success) return { error: 'Invalid profile' }
  const parsed = profileFromForm(fd)
  if (!parsed.success) return { error: firstIssue(parsed.error) }
  const v = parsed.data
  const db = await getDb()
  await db
    .update(travelProfiles)
    .set({
      ...v,
      maxPoints: v.maxPoints == null ? null : Math.round(v.maxPoints),
      tripNightsMin: v.tripNightsMin == null ? null : Math.round(v.tripNightsMin),
      tripNightsMax: v.tripNightsMax == null ? null : Math.round(v.tripNightsMax),
      updatedAt: new Date(),
    })
    .where(and(eq(travelProfiles.id, profileId), eq(travelProfiles.userId, userId)))
  revalidatePath('/', 'layout')
  return { error: null, ok: 'Travel profile saved.' }
}

export async function createProfileAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const name = z.string().trim().min(1).max(60).safeParse(fd.get('name'))
  if (!name.success) return { error: 'Give the profile a name' }
  const db = await getDb()
  const { profile } = await loadAccount(db, userId)
  const [row] = await db
    .insert(travelProfiles)
    .values({
      userId,
      name: name.data,
      homeAirports: profile.homeAirports,
      maxCashUsd: profile.maxCashUsd,
      maxPoints: profile.maxPoints,
      tagPreferences: {},
      dateFlexibility: profile.dateFlexibility,
    })
    .returning({ id: travelProfiles.id })
  await setActiveProfile(db, userId, row!.id)
  revalidatePath('/', 'layout')
  return { error: null, ok: `Created and switched to “${name.data}”.` }
}

export async function switchProfileAction(profileId: string): Promise<void> {
  const userId = await requireUserId()
  if (!z.string().uuid().safeParse(profileId).success) return
  await setActiveProfile(await getDb(), userId, profileId)
  revalidatePath('/', 'layout')
}

export async function deleteProfileAction(profileId: string): Promise<void> {
  const userId = await requireUserId()
  if (!z.string().uuid().safeParse(profileId).success) return
  const db = await getDb()
  const { profiles, profile } = await loadAccount(db, userId)
  if (profiles.length <= 1 || profile.id === profileId) return
  await db.delete(travelProfiles).where(and(eq(travelProfiles.id, profileId), eq(travelProfiles.userId, userId)))
  revalidatePath('/settings')
}

export async function saveValuationAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const parsed = z
    .object({
      pointFloorCents: z.coerce.number().min(0).max(10),
      minAcceptableCpp: z.coerce.number().min(0).max(20),
      foodPerPersonPerDayUsd: z.coerce.number().min(0).max(5000),
      travelers: z.coerce.number().int().min(1).max(12),
    })
    .safeParse(Object.fromEntries(fd))
  if (!parsed.success) return { error: firstIssue(parsed.error) }
  await (await getDb()).update(userSettings).set({ ...parsed.data, updatedAt: new Date() }).where(eq(userSettings.userId, userId))
  revalidatePath('/', 'layout')
  return { error: null, ok: 'Valuation settings saved.' }
}

export async function saveNotificationSettingsAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const parsed = z
    .object({
      notificationEmail: z.preprocess((v) => (v === '' ? null : v), z.string().email().max(200).nullable()),
      timezone: z.string().refine(isValidTimeZone, 'Unknown time zone'),
    })
    .safeParse({ notificationEmail: fd.get('notificationEmail'), timezone: fd.get('timezone') })
  if (!parsed.success) return { error: firstIssue(parsed.error) }
  await (await getDb())
    .update(userSettings)
    .set({
      ...parsed.data,
      emailEnabled: bool(fd.get('emailEnabled')),
      browserNotifications: bool(fd.get('browserNotifications')),
      updatedAt: new Date(),
    })
    .where(eq(userSettings.userId, userId))
  revalidatePath('/', 'layout')
  return { error: null, ok: 'Notification settings saved.' }
}

export async function saveBudgetsAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const parsed = z
    .object({ monthlyApiBudgetUsd: z.coerce.number().min(0).max(1000), aiMonthlyBudgetUsd: z.coerce.number().min(0).max(1000) })
    .safeParse(Object.fromEntries(fd))
  if (!parsed.success) return { error: firstIssue(parsed.error) }
  await (await getDb())
    .update(userSettings)
    .set({ ...parsed.data, aiEnabled: bool(fd.get('aiEnabled')), updatedAt: new Date() })
    .where(eq(userSettings.userId, userId))
  revalidatePath('/settings')
  return { error: null, ok: 'Budgets saved. Paid requests pause automatically before a cap is reached.' }
}

export async function setDemoModeAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const on = bool(fd.get('demoMode'))
  const db = await getDb()
  await db.update(userSettings).set({ demoMode: on, updatedAt: new Date() }).where(eq(userSettings.userId, userId))
  if (on) await seedDemoData(db)
  else await removeDemoData(db)
  revalidatePath('/', 'layout')
  return { error: null, ok: on ? 'Demo data added. Every demo record is labelled DEMO.' : 'Demo data removed.' }
}

export async function saveDiscoveryAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const enabled = bool(fd.get('discoveryEnabled'))
  const hotels = bool(fd.get('hotelDiscoveryEnabled'))
  const cabins = fd.getAll('discoveryCabins').map(String)
  const parsed = z.array(z.enum(CABINS)).safeParse(cabins)
  if (!parsed.success) return { error: firstIssue(parsed.error) }
  if (enabled && parsed.data.length === 0) return { error: 'Choose at least one cabin, or turn discovery off.' }
  await (await getDb()).update(userSettings).set({ discoveryEnabled: enabled, hotelDiscoveryEnabled: hotels, discoveryCabins: parsed.data, updatedAt: new Date() }).where(eq(userSettings.userId, userId))
  revalidatePath('/settings')
  return { error: null, ok: enabled ? 'Discovery settings saved.' : 'Automatic discovery turned off.' }
}

export async function resetPersonalizationAction(_prev: FormState): Promise<FormState> {
  const userId = await requireUserId()
  await resetPersonalization(await getDb(), userId)
  revalidatePath('/', 'layout')
  return { error: null, ok: 'Personalization history cleared. Passed deals are visible again.' }
}

export async function deleteAccountAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const userId = await requireUserId()
  if (fd.get('confirm') !== 'DELETE') return { error: 'Type DELETE to confirm.' }
  await deleteUserData(await getDb(), userId, { includeManualDeals: bool(fd.get('includeManualDeals')) })
  await endSession()
  redirect('/login')
}
