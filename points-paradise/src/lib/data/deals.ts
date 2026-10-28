import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { AppDb } from '../db/client'
import { dealFromRow } from '../db/mappers'
import { dealPriceHistory, deals } from '../db/schema'
import type { Deal } from '../domain/types'
import { detectPriceChange, type Observation, type PriceChange } from '../engine/history'
import { expiryReason } from '../engine/status'
import { toDealColumns, type DealColumns, type ManualDealInput } from './deal-input'

export async function listDeals(db: AppDb, opts: { includeArchived?: boolean; includeDemo?: boolean } = {}): Promise<Deal[]> {
  const conds = []
  if (!opts.includeArchived) conds.push(isNull(deals.archivedAt))
  if (!opts.includeDemo) conds.push(sql`${deals.sourceKind} <> 'demo'`)
  const rows = await db
    .select()
    .from(deals)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(deals.firstSeenAt))
  return rows.map(dealFromRow)
}

export async function getDeal(db: AppDb, id: string): Promise<Deal | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const [row] = await db.select().from(deals).where(eq(deals.id, id))
  return row ? dealFromRow(row) : null
}

export async function getDealByKey(db: AppDb, key: string): Promise<Deal | null> {
  const [row] = await db.select().from(deals).where(eq(deals.dedupeKey, key))
  return row ? dealFromRow(row) : null
}

function observationFromColumns(c: Pick<DealColumns, 'programPoints' | 'comparableCashUsd' | 'mandatoryCashUsd' | 'availability'>, at: Date): Observation {
  return {
    observedAt: at,
    programPoints: c.programPoints,
    cashUsd: c.comparableCashUsd,
    mandatoryCashUsd: c.mandatoryCashUsd,
    availability: c.availability as Observation['availability'],
  }
}

export interface UpsertResult {
  id: string
  isNew: boolean
  change: PriceChange
}

/**
 * Inserts a new opportunity or merges a repeat observation of an existing one
 * (same dedupe key), recording price history and returning what changed.
 */
export async function upsertDeal(
  db: AppDb,
  columns: DealColumns & { sourceKind: string; sourceRef?: string | null; verificationMethod?: string | null },
  opts: {
    now: Date
    verified: boolean
    /** When the source last saw it (e.g. a provider's UpdatedAt). Defaults to now. */
    verifiedAt?: Date
    createdBy?: string | null
    historySource: string
  },
): Promise<UpsertResult> {
  const verifiedAt = opts.verifiedAt ?? opts.now
  const [existing] = await db.select().from(deals).where(eq(deals.dedupeKey, columns.dedupeKey))
  // A provider refresh that carries no cash price (e.g. seats.aero) keeps the comparable cash
  // price, and the record of a lookup attempt, found earlier for the same deal.
  if (existing && columns.comparableCashUsd == null && (existing.comparableCashUsd != null || existing.comparableCashObservedAt != null)) {
    columns = {
      ...columns,
      comparableCashUsd: existing.comparableCashUsd,
      comparableCashSource: existing.comparableCashSource,
      comparableCashObservedAt: existing.comparableCashObservedAt,
      cashProduct: existing.cashProduct ?? columns.cashProduct,
      missingInfo: existing.comparableCashUsd != null ? columns.missingInfo.filter((m) => m !== 'Comparable cash price') : columns.missingInfo,
    }
  }
  const obs = observationFromColumns(columns, opts.now)
  if (!existing) {
    const [row] = await db
      .insert(deals)
      .values({
        ...columns,
        lastVerifiedAt: opts.verified ? verifiedAt : null,
        verificationMethod: opts.verified ? (columns.verificationMethod ?? 'owner_check') : null,
        collectedAt: opts.now,
        firstSeenAt: opts.now,
        lastSeenAt: opts.now,
        createdBy: opts.createdBy ?? null,
      })
      .returning({ id: deals.id })
    await db.insert(dealPriceHistory).values({
      dealId: row!.id,
      observedAt: opts.now,
      programPoints: obs.programPoints,
      cashUsd: obs.cashUsd,
      mandatoryCashUsd: obs.mandatoryCashUsd,
      availability: obs.availability,
      source: opts.historySource,
    })
    return { id: row!.id, isNew: true, change: detectPriceChange(null, obs) }
  }
  const prev: Observation = {
    observedAt: existing.lastSeenAt,
    programPoints: existing.programPoints,
    cashUsd: existing.comparableCashUsd,
    mandatoryCashUsd: existing.mandatoryCashUsd,
    availability: existing.availability as Observation['availability'],
  }
  const change = detectPriceChange(prev, obs)
  await db
    .update(deals)
    .set({
      ...columns,
      // Keep the owner's narrative and images unless the new observation provides them.
      whyNoteworthy: columns.whyNoteworthy ?? existing.whyNoteworthy,
      imageUrl: columns.imageUrl ?? existing.imageUrl,
      lastVerifiedAt: opts.verified ? verifiedAt : existing.lastVerifiedAt,
      verificationMethod: opts.verified ? (columns.verificationMethod ?? 'owner_check') : existing.verificationMethod,
      lastSeenAt: opts.now,
      archivedAt: null,
      archiveReason: null,
      updatedAt: opts.now,
    })
    .where(eq(deals.id, existing.id))
  await db.insert(dealPriceHistory).values({
    dealId: existing.id,
    observedAt: opts.now,
    programPoints: obs.programPoints,
    cashUsd: obs.cashUsd,
    mandatoryCashUsd: obs.mandatoryCashUsd,
    availability: obs.availability,
    source: opts.historySource,
  })
  return { id: existing.id, isNew: false, change }
}

export async function createManualDeal(db: AppDb, userId: string, input: ManualDealInput, now = new Date()): Promise<UpsertResult> {
  const cols = toDealColumns(input, now)
  return upsertDeal(
    db,
    { ...cols, sourceKind: input.sourceUrl && !input.verifiedNow ? 'announcement' : 'manual', verificationMethod: 'owner_check' },
    { now, verified: input.verifiedNow, createdBy: userId, historySource: 'manual' },
  )
}

export async function updateManualDeal(db: AppDb, id: string, input: ManualDealInput, now = new Date()): Promise<void> {
  const cols = toDealColumns(input, now)
  const [existing] = await db.select().from(deals).where(eq(deals.id, id))
  if (!existing) throw new Error('Deal not found')
  if (existing.sourceKind === 'demo') throw new Error('Demo deals cannot be edited')
  // If another record already uses the new natural key, refuse rather than create a duplicate.
  const [clash] = await db.select({ id: deals.id }).from(deals).where(and(eq(deals.dedupeKey, cols.dedupeKey), sql`${deals.id} <> ${id}`))
  if (clash) throw new Error('Another deal with the same route/property and dates already exists')
  await db
    .update(deals)
    .set({
      ...cols,
      lastVerifiedAt: input.verifiedNow ? now : existing.lastVerifiedAt,
      verificationMethod: input.verifiedNow ? 'owner_check' : existing.verificationMethod,
      updatedAt: now,
    })
    .where(eq(deals.id, id))
  await db.insert(dealPriceHistory).values({
    dealId: id,
    observedAt: now,
    programPoints: cols.programPoints,
    cashUsd: cols.comparableCashUsd,
    mandatoryCashUsd: cols.mandatoryCashUsd,
    availability: cols.availability,
    source: 'manual_edit',
  })
}

/** Owner confirms the deal is still available right now on the official site. */
export async function markVerified(db: AppDb, id: string, available: boolean, now = new Date()): Promise<void> {
  const [row] = await db.select().from(deals).where(eq(deals.id, id))
  if (!row) throw new Error('Deal not found')
  if (row.sourceKind === 'demo') throw new Error('Demo deals cannot be verified — they are fictional')
  await db
    .update(deals)
    .set({
      lastVerifiedAt: now,
      verificationMethod: 'owner_check',
      availability: available ? 'available' : 'unavailable',
      sourceKind: row.sourceKind === 'announcement' || row.sourceKind === 'research' ? 'manual' : row.sourceKind,
      lastSeenAt: available ? now : row.lastSeenAt,
      updatedAt: now,
    })
    .where(eq(deals.id, id))
  await db.insert(dealPriceHistory).values({
    dealId: id,
    observedAt: now,
    programPoints: row.programPoints,
    cashUsd: row.comparableCashUsd,
    mandatoryCashUsd: row.mandatoryCashUsd,
    availability: available ? 'available' : 'unavailable',
    source: 'owner_check',
  })
  if (!available) await archiveDeal(db, id, 'availability_disappeared', now)
}

export async function archiveDeal(db: AppDb, id: string, reason: string, now = new Date()): Promise<void> {
  await db.update(deals).set({ archivedAt: now, archiveReason: reason, updatedAt: now }).where(eq(deals.id, id))
}

export async function restoreDeal(db: AppDb, id: string, now = new Date()): Promise<void> {
  await db.update(deals).set({ archivedAt: null, archiveReason: null, updatedAt: now }).where(eq(deals.id, id))
}

export async function deleteDeal(db: AppDb, id: string): Promise<void> {
  await db.delete(deals).where(eq(deals.id, id))
}

/** Moves confirmed-expired and past-travel-date deals into the archive. Returns archived ids. */
export async function archiveExpiredDeals(db: AppDb, now = new Date()): Promise<string[]> {
  const rows = await db.select().from(deals).where(isNull(deals.archivedAt))
  const archived: string[] = []
  for (const row of rows) {
    const reason = expiryReason(dealFromRow(row), now)
    if (reason) {
      await archiveDeal(db, row.id, reason, now)
      archived.push(row.id)
    }
  }
  return archived
}

export async function priceHistory(db: AppDb, dealId: string) {
  return db.select().from(dealPriceHistory).where(eq(dealPriceHistory.dealId, dealId)).orderBy(asc(dealPriceHistory.observedAt))
}

/** History across all deals on a route/cabin or property, for calendars and predictions. */
export async function relatedHistory(db: AppDb, deal: Deal) {
  const related = await db
    .select({ id: deals.id, travelStart: deals.travelStart })
    .from(deals)
    .where(
      deal.kind === 'flight'
        ? and(
            eq(deals.kind, 'flight'),
            deal.originAirport ? eq(deals.originAirport, deal.originAirport) : sql`true`,
            deal.destination.airport ? eq(deals.destAirport, deal.destination.airport) : sql`true`,
            // Never mix fictional demo history with real observations.
            deal.sourceKind === 'demo' ? eq(deals.sourceKind, 'demo') : sql`${deals.sourceKind} <> 'demo'`,
          )
        : and(eq(deals.kind, deal.kind), eq(deals.providerName, deal.providerName)),
    )
  const ids = related.map((r) => r.id)
  if (ids.length === 0) return []
  return db.select().from(dealPriceHistory).where(inArray(dealPriceHistory.dealId, ids)).orderBy(asc(dealPriceHistory.observedAt))
}

/** First vs latest observed points per deal; positive = price fell (percent). */
export async function priceImprovements(db: AppDb): Promise<Map<string, number>> {
  const rows = await db
    .select({
      dealId: dealPriceHistory.dealId,
      first: sql<number | null>`(array_agg(${dealPriceHistory.programPoints} order by ${dealPriceHistory.observedAt} asc) filter (where ${dealPriceHistory.programPoints} is not null))[1]`,
      last: sql<number | null>`(array_agg(${dealPriceHistory.programPoints} order by ${dealPriceHistory.observedAt} desc) filter (where ${dealPriceHistory.programPoints} is not null))[1]`,
    })
    .from(dealPriceHistory)
    .groupBy(dealPriceHistory.dealId)
  const map = new Map<string, number>()
  for (const r of rows) {
    const first = r.first == null ? null : Number(r.first)
    const last = r.last == null ? null : Number(r.last)
    if (first && last != null && first > 0) map.set(r.dealId, Math.round(((first - last) / first) * 1000) / 10)
  }
  return map
}
