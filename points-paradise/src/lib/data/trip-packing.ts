import { and, asc, eq } from 'drizzle-orm'
import type { AppDb } from '../db/client'
import { tripPackingItems, trips } from '../db/schema'
import { PACKING_ORDER, type PackingSuggestion } from '../trips/packing'

export type PackingRow = typeof tripPackingItems.$inferSelect

const MAX_ITEMS = 200

async function owns(db: AppDb, userId: string, tripId: string): Promise<boolean> {
  const [t] = await db.select({ id: trips.id }).from(trips).where(and(eq(trips.id, tripId), eq(trips.userId, userId)))
  return !!t
}

async function ownedItem(db: AppDb, userId: string, itemId: string): Promise<PackingRow | null> {
  const [row] = await db
    .select({ item: tripPackingItems })
    .from(tripPackingItems)
    .innerJoin(trips, eq(trips.id, tripPackingItems.tripId))
    .where(and(eq(tripPackingItems.id, itemId), eq(trips.userId, userId)))
  return row?.item ?? null
}

/** The packing list, by category; removed suggestions are left out. */
export async function listPacking(db: AppDb, userId: string, tripId: string): Promise<PackingRow[]> {
  if (!(await owns(db, userId, tripId))) return []
  const rows = await db.select().from(tripPackingItems).where(eq(tripPackingItems.tripId, tripId)).orderBy(asc(tripPackingItems.createdAt))
  return rows.filter((r) => !r.dismissed).sort((a, b) => PACKING_ORDER.indexOf(a.category) - PACKING_ORDER.indexOf(b.category))
}

/**
 * Adds suggestions not on the list yet. Ones the owner removed earlier stay
 * removed; existing ones get the latest reason (for example, new weather).
 */
export async function addSuggestions(db: AppDb, userId: string, tripId: string, list: readonly PackingSuggestion[]): Promise<number> {
  if (!(await owns(db, userId, tripId))) return 0
  const existing = await db.select().from(tripPackingItems).where(eq(tripPackingItems.tripId, tripId))
  const byLabel = new Map(existing.map((r) => [r.label.toLowerCase(), r]))
  let added = 0
  for (const s of list) {
    const have = byLabel.get(s.label.toLowerCase())
    if (have) {
      if (have.reason && have.reason !== s.reason) await db.update(tripPackingItems).set({ reason: s.reason }).where(eq(tripPackingItems.id, have.id))
      continue
    }
    if (existing.length + added >= MAX_ITEMS) break
    await db.insert(tripPackingItems).values({ tripId, label: s.label, category: s.category, reason: s.reason })
    added++
  }
  return added
}

export async function addOwnPackingItem(db: AppDb, userId: string, tripId: string, label: string): Promise<{ ok: boolean; error?: string }> {
  const clean = label.trim().slice(0, 80)
  if (!clean) return { ok: false, error: 'Type what to pack' }
  if (!(await owns(db, userId, tripId))) return { ok: false, error: 'Trip not found' }
  const existing = await db.select().from(tripPackingItems).where(eq(tripPackingItems.tripId, tripId))
  if (existing.length >= MAX_ITEMS) return { ok: false, error: `A list can hold up to ${MAX_ITEMS} things` }
  const same = existing.find((r) => r.label.toLowerCase() === clean.toLowerCase())
  if (same) {
    if (same.dismissed) await db.update(tripPackingItems).set({ dismissed: false }).where(eq(tripPackingItems.id, same.id))
    return { ok: true }
  }
  await db.insert(tripPackingItems).values({ tripId, label: clean, category: 'other', reason: null })
  return { ok: true }
}

export async function setPacked(db: AppDb, userId: string, itemId: string, packed: boolean): Promise<void> {
  if (await ownedItem(db, userId, itemId)) await db.update(tripPackingItems).set({ packed }).where(eq(tripPackingItems.id, itemId))
}

/** Your own items are deleted; suggestions are hidden so they aren't suggested again. */
export async function removePackingItem(db: AppDb, userId: string, itemId: string): Promise<void> {
  const item = await ownedItem(db, userId, itemId)
  if (!item) return
  if (item.reason == null) await db.delete(tripPackingItems).where(eq(tripPackingItems.id, itemId))
  else await db.update(tripPackingItems).set({ dismissed: true, packed: false }).where(eq(tripPackingItems.id, itemId))
}
