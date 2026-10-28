import { eq } from 'drizzle-orm'
import type { AppDb } from '../db/client'
import {
  collections,
  deals,
  feedback,
  notifications,
  pointsWallets,
  savedDealCollections,
  savedDeals,
  searchHistory,
  travelProfiles,
  tripItems,
  trips,
  userSettings,
  users,
  watchlists,
} from '../db/schema'

/** Everything stored about the owner, as portable JSON. No secrets are stored, so none are exported. */
export async function exportUserData(db: AppDb, userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId))
  const saved = await db.select().from(savedDeals).where(eq(savedDeals.userId, userId))
  const savedIds = new Set(saved.map((s) => s.id))
  const links = (await db.select().from(savedDealCollections)).filter((l) => savedIds.has(l.savedDealId))
  const tripRows = await db.select().from(trips).where(eq(trips.userId, userId))
  const tripIds = new Set(tripRows.map((t) => t.id))
  return {
    exportedAt: new Date().toISOString(),
    format: 'points-paradise-export-v1',
    user: user ? { authIdentifier: user.authIdentifier, createdAt: user.createdAt } : null,
    settings: (await db.select().from(userSettings).where(eq(userSettings.userId, userId)))[0] ?? null,
    wallet: (await db.select().from(pointsWallets).where(eq(pointsWallets.userId, userId)))[0] ?? null,
    travelProfiles: await db.select().from(travelProfiles).where(eq(travelProfiles.userId, userId)),
    collections: await db.select().from(collections).where(eq(collections.userId, userId)),
    savedDeals: saved,
    savedDealCollections: links,
    watchlists: await db.select().from(watchlists).where(eq(watchlists.userId, userId)),
    trips: tripRows.map(({ shareToken, ...t }) => ({ ...t, shared: shareToken != null })),
    tripItems: (await db.select().from(tripItems)).filter((i) => tripIds.has(i.tripId)),
    notifications: await db.select().from(notifications).where(eq(notifications.userId, userId)),
    feedback: await db.select().from(feedback).where(eq(feedback.userId, userId)),
    searchHistory: await db.select().from(searchHistory).where(eq(searchHistory.userId, userId)),
    manualDeals: await db.select().from(deals).where(eq(deals.createdBy, userId)),
  }
}

/** Deletes the owner's personal data. Shared reference data (partners, provider deals) is kept. */
export async function deleteUserData(db: AppDb, userId: string, opts: { includeManualDeals: boolean }): Promise<void> {
  if (opts.includeManualDeals) await db.delete(deals).where(eq(deals.createdBy, userId))
  // Cascades remove settings, wallet, profiles, collections, saved deals, watchlists, trips, notifications, feedback and history.
  await db.delete(users).where(eq(users.id, userId))
}
