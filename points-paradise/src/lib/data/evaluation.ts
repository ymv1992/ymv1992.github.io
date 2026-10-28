import { asc, eq, inArray, isNull } from 'drizzle-orm'
import type { AppDb } from '../db/client'
import { dealFromRow, partnerFromRow, preferencesFromProfile, promotionFromRow } from '../db/mappers'
import { deals, transferPartners, transferPromotions } from '../db/schema'
import type { CardType } from '../domain/constants'
import type { Deal } from '../domain/types'
import { buildPeerPrices, evaluateDeal, type EvaluatedDeal, type EvaluationContext } from '../engine/evaluate'
import { loadAccount, type Account } from './account'
import { dismissedDealIds } from './feedback'
import { listSaved } from './saved'

export interface EvaluationData {
  account: Account
  ctx: EvaluationContext
  items: EvaluatedDeal[]
  byId: Map<string, EvaluatedDeal>
  savedIds: Set<string>
  dismissedIds: Set<string>
  partners: EvaluationContext['partners']
  promotions: EvaluationContext['promotions']
}

export function buildContext(
  account: Account,
  partners: EvaluationContext['partners'],
  promotions: EvaluationContext['promotions'],
  peers: Map<string, number[]>,
  now: Date,
): EvaluationContext {
  return {
    now,
    card: account.wallet.cardType as CardType,
    partners,
    promotions,
    partnerBalances: account.wallet.partnerBalances,
    pointFloorCents: account.settings.pointFloorCents,
    pointsBalance: account.wallet.chaseBalance,
    maxCashUsd: account.profile.maxCashUsd,
    profile: preferencesFromProfile(account.profile),
    displayTimeZone: account.settings.timezone,
    peerPrices: peers,
  }
}

/** Evaluates a single deal (e.g. inside a server action) without loading every deal. */
export async function evaluateOne(db: AppDb, userId: string, dealId: string, now = new Date()) {
  const [row] = await db.select().from(deals).where(eq(deals.id, dealId))
  if (!row) return null
  const account = await loadAccount(db, userId)
  const partners = new Map((await db.select().from(transferPartners)).map((r) => [r.id, partnerFromRow(r)]))
  const promotions = (await db.select().from(transferPromotions)).map(promotionFromRow)
  const ctx = buildContext(account, partners, promotions, new Map(), now)
  return { evaluated: evaluateDeal(dealFromRow(row), ctx), account }
}

/** Values for a known set of deals (such as fresh search results) without loading every deal. */
export async function evaluateMany(db: AppDb, userId: string, dealIds: readonly string[], now = new Date()): Promise<Map<string, EvaluatedDeal>> {
  if (dealIds.length === 0) return new Map()
  const rows = await db.select().from(deals).where(inArray(deals.id, [...dealIds]))
  const account = await loadAccount(db, userId)
  const partners = new Map((await db.select().from(transferPartners)).map((r) => [r.id, partnerFromRow(r)]))
  const promotions = (await db.select().from(transferPromotions)).map(promotionFromRow)
  const ctx = buildContext(account, partners, promotions, new Map(), now)
  return new Map(rows.map((r) => [r.id, evaluateDeal(dealFromRow(r), ctx)]))
}

/**
 * Loads everything needed to value and rank deals for the owner. Demo deals
 * are included only when demo mode is on. Archived deals are excluded unless asked.
 */
export async function loadEvaluationData(db: AppDb, userId: string, opts: { now?: Date; includeArchived?: boolean } = {}): Promise<EvaluationData> {
  const now = opts.now ?? new Date()
  const account = await loadAccount(db, userId)
  const partnerRows = await db.select().from(transferPartners)
  const promoRows = await db.select().from(transferPromotions)
  const dealRows = await db
    .select()
    .from(deals)
    .where(opts.includeArchived ? undefined : isNull(deals.archivedAt))
    .orderBy(asc(deals.createdAt))
  const saved = await listSaved(db, userId)
  const dismissedIds = await dismissedDealIds(db, userId)

  const partners = new Map(partnerRows.map((r) => [r.id, partnerFromRow(r)]))
  const promotions = promoRows.map(promotionFromRow)
  const all: Deal[] = dealRows.map(dealFromRow).filter((d) => account.settings.demoMode || d.sourceKind !== 'demo')
  const ctx = buildContext(account, partners, promotions, buildPeerPrices(all), now)
  const items = all.map((d) => evaluateDeal(d, ctx))
  return {
    account,
    ctx,
    items,
    byId: new Map(items.map((i) => [i.deal.id, i])),
    savedIds: new Set(saved.map((s) => s.dealId)),
    dismissedIds,
    partners,
    promotions,
  }
}
