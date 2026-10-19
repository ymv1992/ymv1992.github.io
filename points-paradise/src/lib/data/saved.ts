import { and, asc, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import type { AppDb } from '../db/client'
import { collections, savedDealCollections, savedDeals } from '../db/schema'

export interface SaveSnapshot {
  programPoints: number | null
  chasePoints: number | null
  mandatoryCashUsd: number | null
  comparableCashUsd: number | null
  cpp: number | null
}

/**
 * Saves a deal (idempotent). The first save records the original prices so
 * later changes can be shown; saving again only adds collections.
 */
export async function saveDeal(
  db: AppDb,
  userId: string,
  dealId: string,
  snapshot: SaveSnapshot,
  collectionIds: string[] = [],
  now = new Date(),
): Promise<string> {
  const [inserted] = await db
    .insert(savedDeals)
    .values({
      userId,
      dealId,
      savedAt: now,
      originalProgramPoints: snapshot.programPoints,
      originalChasePoints: snapshot.chasePoints,
      originalCashUsd: snapshot.mandatoryCashUsd,
      originalComparableUsd: snapshot.comparableCashUsd,
      originalCpp: snapshot.cpp,
      latestProgramPoints: snapshot.programPoints,
      latestChasePoints: snapshot.chasePoints,
      latestCpp: snapshot.cpp,
      latestObservedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: savedDeals.id })
  const id =
    inserted?.id ??
    (await db.select({ id: savedDeals.id }).from(savedDeals).where(and(eq(savedDeals.userId, userId), eq(savedDeals.dealId, dealId))))[0]!.id
  // Re-saving an archived item brings it back.
  if (!inserted) await db.update(savedDeals).set({ archivedAt: null }).where(eq(savedDeals.id, id))
  await addToCollections(db, userId, id, collectionIds)
  return id
}

async function ownedCollectionIds(db: AppDb, userId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return []
  const rows = await db
    .select({ id: collections.id })
    .from(collections)
    .where(and(eq(collections.userId, userId), inArray(collections.id, ids)))
  return rows.map((r) => r.id)
}

export async function addToCollections(db: AppDb, userId: string, savedDealId: string, collectionIds: string[]): Promise<void> {
  const owned = await ownedCollectionIds(db, userId, collectionIds)
  if (owned.length === 0) return
  await db
    .insert(savedDealCollections)
    .values(owned.map((collectionId) => ({ savedDealId, collectionId })))
    .onConflictDoNothing()
}

/** Replaces the collections a saved deal belongs to. */
export async function setCollections(db: AppDb, userId: string, savedDealId: string, collectionIds: string[]): Promise<void> {
  const [own] = await db.select({ id: savedDeals.id }).from(savedDeals).where(and(eq(savedDeals.id, savedDealId), eq(savedDeals.userId, userId)))
  if (!own) throw new Error('Saved deal not found')
  await db.delete(savedDealCollections).where(eq(savedDealCollections.savedDealId, savedDealId))
  await addToCollections(db, userId, savedDealId, collectionIds)
}

export async function unsaveDeal(db: AppDb, userId: string, dealId: string): Promise<void> {
  await db.delete(savedDeals).where(and(eq(savedDeals.userId, userId), eq(savedDeals.dealId, dealId)))
}

export async function archiveSaved(db: AppDb, userId: string, savedDealId: string, archived: boolean, now = new Date()): Promise<void> {
  await db
    .update(savedDeals)
    .set({ archivedAt: archived ? now : null })
    .where(and(eq(savedDeals.id, savedDealId), eq(savedDeals.userId, userId)))
}

export async function updateSavedDeal(
  db: AppDb,
  userId: string,
  savedDealId: string,
  patch: Partial<{ notes: string | null; alertPriceDrop: boolean; alertAvailability: boolean; alertDeadline: boolean; rating: number | null; bookedAt: Date | null }>,
): Promise<void> {
  await db
    .update(savedDeals)
    .set(patch)
    .where(and(eq(savedDeals.id, savedDealId), eq(savedDeals.userId, userId)))
}

/** Updates the "latest observed" snapshot used to show changes since saving. */
export async function refreshSavedSnapshot(db: AppDb, savedDealId: string, latest: Omit<SaveSnapshot, 'mandatoryCashUsd' | 'comparableCashUsd'>, now = new Date()) {
  await db
    .update(savedDeals)
    .set({ latestProgramPoints: latest.programPoints, latestChasePoints: latest.chasePoints, latestCpp: latest.cpp, latestObservedAt: now })
    .where(eq(savedDeals.id, savedDealId))
}

export async function listSaved(db: AppDb, userId: string, opts: { archived?: boolean } = {}) {
  const rows = await db
    .select()
    .from(savedDeals)
    .where(and(eq(savedDeals.userId, userId), opts.archived ? isNotNull(savedDeals.archivedAt) : isNull(savedDeals.archivedAt)))
    .orderBy(desc(savedDeals.savedAt))
  const ids = rows.map((r) => r.id)
  const links = ids.length
    ? await db.select().from(savedDealCollections).where(inArray(savedDealCollections.savedDealId, ids))
    : []
  return rows.map((r) => ({ ...r, collectionIds: links.filter((l) => l.savedDealId === r.id).map((l) => l.collectionId) }))
}

export type SavedDealRecord = Awaited<ReturnType<typeof listSaved>>[number]

export async function listCollections(db: AppDb, userId: string) {
  return db.select().from(collections).where(eq(collections.userId, userId)).orderBy(asc(collections.sort), asc(collections.createdAt))
}

export async function createCollection(db: AppDb, userId: string, name: string): Promise<string> {
  const clean = name.trim().slice(0, 60)
  if (!clean) throw new Error('Collection name is required')
  const [row] = await db
    .insert(collections)
    .values({ userId, name: clean, sort: 100 })
    .onConflictDoNothing()
    .returning({ id: collections.id })
  if (!row) throw new Error('A collection with that name already exists')
  return row.id
}

export async function renameCollection(db: AppDb, userId: string, id: string, name: string): Promise<void> {
  const clean = name.trim().slice(0, 60)
  if (!clean) throw new Error('Collection name is required')
  await db.update(collections).set({ name: clean }).where(and(eq(collections.id, id), eq(collections.userId, userId)))
}

export async function deleteCollection(db: AppDb, userId: string, id: string): Promise<void> {
  // Saved deals stay saved; only their membership in this collection is removed (cascade).
  await db.delete(collections).where(and(eq(collections.id, id), eq(collections.userId, userId)))
}
