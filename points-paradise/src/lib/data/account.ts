import { and, asc, eq } from 'drizzle-orm'
import { DEFAULT_COLLECTIONS, HOME_AIRPORTS_DEFAULT } from '../domain/constants'
import { ALERT_EVENT_TYPES } from '../engine/notify'
import type { AppDb } from '../db/client'
import { collections, pointsWallets, travelProfiles, userSettings, users, type AlertPrefsJson } from '../db/schema'

export const DEFAULT_ALERT_PREFS: AlertPrefsJson = {
  enabledTypes: [...ALERT_EVENT_TYPES],
  minCpp: 3,
  maxPoints: null,
  maxCashUsd: null,
  destinations: [],
  cabins: [],
  hotelCategories: [],
  travelFrom: null,
  travelTo: null,
  urgentOnly: false,
  frequency: 'instant',
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
  reminderOffsets: ['7d', '3d', '24h', '6h', '1h'],
}

/** Creates the owner's account and defaults on first login. Idempotent. */
export async function ensureOwnerAccount(db: AppDb, email: string): Promise<string> {
  const identifier = email.trim().toLowerCase()
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.authIdentifier, identifier))
  if (existing[0]) return existing[0].id
  const [user] = await db.insert(users).values({ authIdentifier: identifier }).onConflictDoNothing().returning({ id: users.id })
  const userId = user?.id ?? (await db.select({ id: users.id }).from(users).where(eq(users.authIdentifier, identifier)))[0]!.id
  await initializeUserDefaults(db, userId, identifier)
  return userId
}

export async function initializeUserDefaults(db: AppDb, userId: string, email: string | null): Promise<void> {
  await db.insert(pointsWallets).values({ userId, chaseBalance: 150_000, cardType: 'sapphire_preferred' }).onConflictDoNothing()
  const [profile] = await db
    .insert(travelProfiles)
    .values({
      userId,
      name: 'My travel style',
      isActive: true,
      tripStyles: ['romantic', 'adventure', 'luxury'],
      tagPreferences: {
        luxury: 2,
        scenic: 2,
        unique_stay: 2,
        hidden_gem: 1,
        romantic: 1,
        adventure: 1,
        overwater: 1,
        photography: 1,
      },
      homeAirports: [...HOME_AIRPORTS_DEFAULT],
      maxCashUsd: 1000,
      maxPoints: 150_000,
      tripNightsMin: 2,
      tripNightsMax: 10,
      dateFlexibility: 'few_weeks',
    })
    .returning({ id: travelProfiles.id })
  await db
    .insert(userSettings)
    .values({ userId, notificationEmail: email, alertPrefs: DEFAULT_ALERT_PREFS, activeProfileId: profile?.id ?? null })
    .onConflictDoNothing()
  await db
    .insert(collections)
    .values(DEFAULT_COLLECTIONS.map((name, i) => ({ userId, name, isDefault: true, sort: i })))
    .onConflictDoNothing()
}

export async function loadAccount(db: AppDb, userId: string) {
  const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, userId))
  const [wallet] = await db.select().from(pointsWallets).where(eq(pointsWallets.userId, userId))
  const profiles = await db.select().from(travelProfiles).where(eq(travelProfiles.userId, userId)).orderBy(asc(travelProfiles.createdAt))
  if (!settings || !wallet || profiles.length === 0) {
    await initializeUserDefaults(db, userId, null)
    return loadAccount(db, userId)
  }
  const profile = profiles.find((p) => p.id === settings.activeProfileId) ?? profiles.find((p) => p.isActive) ?? profiles[0]!
  return { settings, wallet, profile, profiles }
}

export type Account = Awaited<ReturnType<typeof loadAccount>>

export async function setActiveProfile(db: AppDb, userId: string, profileId: string): Promise<void> {
  const owned = await db
    .select({ id: travelProfiles.id })
    .from(travelProfiles)
    .where(and(eq(travelProfiles.id, profileId), eq(travelProfiles.userId, userId)))
  if (!owned[0]) throw new Error('Profile not found')
  await db.update(travelProfiles).set({ isActive: false }).where(eq(travelProfiles.userId, userId))
  await db.update(travelProfiles).set({ isActive: true, updatedAt: new Date() }).where(eq(travelProfiles.id, profileId))
  await db.update(userSettings).set({ activeProfileId: profileId, updatedAt: new Date() }).where(eq(userSettings.userId, userId))
}
