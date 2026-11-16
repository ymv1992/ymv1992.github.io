'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getDb } from '@/lib/db/client'
import { holdings, manualAssets, notes, trades, watchlist } from '@/lib/db/schema'
import { classifySymbol, normalizeSymbol } from '@/lib/domain/reference'
import { ASSET_CATEGORIES, ASSET_CLASSES, ASSET_STATUSES, BUCKETS, HOLDING_STATUSES, RISK_PROFILES, TRADE_TYPES, type AssetCategory, type AssetClass, type AssetStatus, type Bucket, type HoldingStatus, type RiskProfile, type TradeType } from '@/lib/domain/types'
import { diffImport, parseHoldings, type ImportDiffRow, type ParsedHolding } from '@/lib/engine/import'
import { applyTrade } from '@/lib/engine/portfolio'
import { finnhubProfileName } from '@/lib/providers/market'
import { audit, deleteAllData, listHoldings, loadOverview, loadProfile, recordSnapshot, refreshNews, refreshQuotes, saveProfile } from '@/lib/data/store'
import { config } from '@/lib/server/config'
import { requireUserId } from '@/lib/server/session'
import type { FormState } from '@/components/forms'
import { isoDay } from '@/lib/time'

async function ctx() {
  const userId = await requireUserId()
  return { userId, db: await getDb() }
}

function str(fd: FormData, key: string, max = 2000): string {
  return String(fd.get(key) ?? '').trim().slice(0, max)
}

/** Parses a number field; returns null when blank, NaN when unreadable. */
function num(fd: FormData, key: string): number | null {
  const raw = String(fd.get(key) ?? '').replace(/[$,%\s]/g, '')
  if (!raw) return null
  return Number(raw)
}

function oneOf<T extends string>(value: string, allowed: readonly T[]): T | null {
  return (allowed as readonly string[]).includes(value) ? (value as T) : null
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)
const today = () => isoDay()
const bad = (n: number | null) => n != null && !Number.isFinite(n)

function refreshAll() {
  revalidatePath('/', 'layout')
}

/* ---------- Prices and news ---------- */

export async function refreshPricesAction(): Promise<void> {
  const { db, userId } = await ctx()
  const hs = await listHoldings(db, userId)
  await refreshQuotes(db, hs.map((h) => ({ symbol: h.symbol, crypto: h.assetClass === 'crypto' })), { finnhub: config.finnhubKey(), coingecko: config.coingeckoKey() }, { force: true })
  await recordSnapshot(db, userId, await loadOverview(db, userId))
  refreshAll()
}

export async function refreshNewsAction(): Promise<void> {
  const { db, userId } = await ctx()
  const hs = await listHoldings(db, userId)
  await refreshNews(db, hs.filter((h) => h.assetClass !== 'crypto').map((h) => h.symbol), config.finnhubKey(), { force: true })
  revalidatePath('/news')
}

/* ---------- Import ---------- */

export interface ImportPreview {
  error: string | null
  rows: ImportDiffRow[]
  warnings: string[]
}

export async function previewImportAction(_prev: ImportPreview, fd: FormData): Promise<ImportPreview> {
  const { db, userId } = await ctx()
  const text = String(fd.get('text') ?? '').slice(0, 200_000)
  const parsed = parseHoldings(text)
  if (!parsed.rows.length) return { error: parsed.errors[0] ?? 'Nothing readable was found.', rows: [], warnings: parsed.errors.slice(1) }
  const existing = await listHoldings(db, userId)
  return { error: null, rows: diffImport(parsed.rows, existing), warnings: parsed.errors }
}

export async function applyImportAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { db, userId } = await ctx()
  let rows: ParsedHolding[]
  try {
    rows = JSON.parse(String(fd.get('rows') ?? '[]')) as ParsedHolding[]
  } catch {
    return { error: 'The preview expired. Preview the import again.' }
  }
  const status = oneOf(str(fd, 'status'), HOLDING_STATUSES) ?? 'unverified'
  const asOf = isDate(str(fd, 'asOf')) ? str(fd, 'asOf') : today()
  const replace = fd.get('replace') === 'on'
  const existing = await listHoldings(db, userId)
  const diff = diffImport(
    rows.filter((r) => typeof r.symbol === 'string' && /^[A-Z0-9.\-]{1,12}$/.test(r.symbol) && Number.isFinite(r.quantity) && r.quantity > 0 && (r.avgCost == null || (Number.isFinite(r.avgCost) && r.avgCost >= 0))),
    existing,
  )
  const key = config.finnhubKey()
  let added = 0
  let updated = 0
  let skipped = 0
  for (const r of diff) {
    const account = (r.account ?? '').slice(0, 80)
    if (r.change === 'new') {
      const c = classifySymbol(r.symbol)
      let name = r.name || c.name || ''
      if (!name && key && c.assetClass !== 'crypto') name = (await finnhubProfileName(r.symbol, key).catch(() => null)) ?? ''
      await db.insert(holdings).values({ userId, account, symbol: r.symbol, name: name.slice(0, 120), assetClass: c.assetClass, bucket: c.bucket, quantity: r.quantity, avgCost: r.avgCost, status, asOf, purchaseDate: r.purchaseDate })
      added++
    } else if (r.change === 'changed' && replace) {
      await db
        .update(holdings)
        .set({ quantity: r.quantity, ...(r.avgCost != null ? { avgCost: r.avgCost } : {}), status, asOf, updatedAt: new Date() })
        .where(and(eq(holdings.userId, userId), eq(holdings.account, account), eq(holdings.symbol, r.symbol)))
      updated++
    } else skipped++
  }
  await audit(db, userId, 'holdings.imported', `${added} added, ${updated} updated, ${skipped} left unchanged; marked ${status} as of ${asOf}`)
  await refreshQuotes(db, diff.map((r) => ({ symbol: r.symbol, crypto: classifySymbol(r.symbol).assetClass === 'crypto' })), { finnhub: key, coingecko: config.coingeckoKey() }).catch(() => null)
  refreshAll()
  return { error: null, ok: `${added} added, ${updated} updated, ${skipped} left unchanged.` }
}

/* ---------- Holdings ---------- */

export async function saveHoldingAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { db, userId } = await ctx()
  const id = str(fd, 'id')
  const symbol = normalizeSymbol(str(fd, 'symbol', 12))
  const quantity = num(fd, 'quantity')
  const avgCost = num(fd, 'avgCost')
  if (!/^[A-Z0-9.\-]{1,12}$/.test(symbol)) return { error: 'Enter a ticker symbol, such as VTI.' }
  if (quantity == null || !Number.isFinite(quantity) || quantity <= 0) return { error: 'Enter how many shares or units you hold.' }
  if (bad(avgCost) || (avgCost != null && avgCost < 0)) return { error: 'Average cost must be a number, or blank if unknown.' }
  const guess = classifySymbol(symbol)
  const values = {
    symbol,
    account: str(fd, 'account', 80),
    name: str(fd, 'name', 120) || guess.name || '',
    assetClass: (oneOf(str(fd, 'assetClass'), ASSET_CLASSES) ?? guess.assetClass) as AssetClass,
    bucket: (oneOf(str(fd, 'bucket'), BUCKETS) ?? guess.bucket) as Bucket,
    quantity,
    avgCost,
    status: (oneOf(str(fd, 'status'), HOLDING_STATUSES) ?? 'unverified') as HoldingStatus,
    asOf: isDate(str(fd, 'asOf')) ? str(fd, 'asOf') : today(),
    purchaseDate: isDate(str(fd, 'purchaseDate')) ? str(fd, 'purchaseDate') : null,
    thesis: str(fd, 'thesis'),
    sellCondition: str(fd, 'sellCondition'),
    notes: str(fd, 'notes'),
  }
  try {
    if (id) {
      await db.update(holdings).set({ ...values, updatedAt: new Date() }).where(and(eq(holdings.id, id), eq(holdings.userId, userId)))
      await audit(db, userId, 'holding.updated', `${symbol}: ${quantity} @ ${avgCost ?? 'unknown cost'}, ${values.status}`)
    } else {
      await db.insert(holdings).values({ userId, ...values })
      await audit(db, userId, 'holding.added', `${symbol}: ${quantity} @ ${avgCost ?? 'unknown cost'}, ${values.status}`)
    }
  } catch {
    return { error: `${symbol} is already in this account. Edit the existing holding instead.` }
  }
  await refreshQuotes(db, [{ symbol, crypto: values.assetClass === 'crypto' }], { finnhub: config.finnhubKey(), coingecko: config.coingeckoKey() }).catch(() => null)
  refreshAll()
  if (id) redirect('/portfolio')
  return { error: null, ok: `${symbol} saved.` }
}

export async function deleteHoldingAction(fd: FormData): Promise<void> {
  const { db, userId } = await ctx()
  const [row] = await db.delete(holdings).where(and(eq(holdings.id, str(fd, 'id')), eq(holdings.userId, userId))).returning({ symbol: holdings.symbol })
  if (row) await audit(db, userId, 'holding.deleted', row.symbol)
  refreshAll()
  redirect('/portfolio')
}

export async function confirmHoldingAction(fd: FormData): Promise<void> {
  const { db, userId } = await ctx()
  const [row] = await db.update(holdings).set({ status: 'confirmed', asOf: today(), updatedAt: new Date() }).where(and(eq(holdings.id, str(fd, 'id')), eq(holdings.userId, userId))).returning({ symbol: holdings.symbol })
  if (row) await audit(db, userId, 'holding.confirmed', row.symbol)
  refreshAll()
}

/* ---------- Other assets ---------- */

export async function saveAssetAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { db, userId } = await ctx()
  const id = str(fd, 'id')
  const name = str(fd, 'name', 120)
  const value = num(fd, 'value')
  const liability = num(fd, 'liability') ?? 0
  const category = oneOf(str(fd, 'category'), ASSET_CATEGORIES)
  if (!name) return { error: 'Give the asset a name.' }
  if (!category) return { error: 'Choose a category.' }
  if (bad(value) || !Number.isFinite(liability) || liability < 0 || (value != null && value < 0)) return { error: 'Amounts must be numbers.' }
  // Real estate and business interests are never treated as liquid or as part of the investable portfolio.
  const illiquid = category === 'real_estate' || category === 'business' || category === 'private'
  const inPortfolio = !illiquid && fd.get('inPortfolio') === 'on'
  const values = {
    name,
    category: category as AssetCategory,
    value,
    liability,
    liquid: !illiquid && fd.get('liquid') === 'on',
    inPortfolio,
    bucket: inPortfolio ? (oneOf(str(fd, 'bucket'), BUCKETS) as Bucket | null) : null,
    status: (value == null ? 'needs_input' : (oneOf(str(fd, 'status'), ASSET_STATUSES) ?? 'unverified')) as AssetStatus,
    asOf: isDate(str(fd, 'asOf')) ? str(fd, 'asOf') : today(),
    notes: str(fd, 'notes'),
  }
  if (id) await db.update(manualAssets).set({ ...values, updatedAt: new Date() }).where(and(eq(manualAssets.id, id), eq(manualAssets.userId, userId)))
  else await db.insert(manualAssets).values({ userId, ...values })
  await audit(db, userId, id ? 'asset.updated' : 'asset.added', `${name}: ${value ?? 'value not entered'}`)
  refreshAll()
  return { error: null, ok: `${name} saved.` }
}

export async function deleteAssetAction(fd: FormData): Promise<void> {
  const { db, userId } = await ctx()
  const [row] = await db.delete(manualAssets).where(and(eq(manualAssets.id, str(fd, 'id')), eq(manualAssets.userId, userId))).returning({ name: manualAssets.name })
  if (row) await audit(db, userId, 'asset.deleted', row.name)
  refreshAll()
}

/* ---------- Profile, targets, rules ---------- */

export async function saveTargetsAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { db, userId } = await ctx()
  const targets = {} as Record<Bucket, number>
  for (const b of BUCKETS) {
    const v = num(fd, `target_${b}`) ?? 0
    if (!Number.isFinite(v) || v < 0 || v > 100) return { error: 'Each target must be between 0 and 100.' }
    targets[b] = v
  }
  const sum = BUCKETS.reduce((s, b) => s + targets[b], 0)
  if (Math.abs(sum - 100) > 0.01) return { error: `Targets add up to ${sum.toFixed(1)}%. They need to total 100%.` }
  await saveProfile(db, userId, { targets })
  await audit(db, userId, 'targets.updated', BUCKETS.map((b) => `${b} ${targets[b]}%`).join(', '))
  refreshAll()
  return { error: null, ok: 'Target mix saved.' }
}

export async function saveRulesAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { db, userId } = await ctx()
  const keys = ['maxSingleStockPct', 'maxThemePct', 'minIndexPct', 'maxSpeculativePct', 'maxCryptoPct'] as const
  const rules = { ...(await loadProfile(db, userId)).rules }
  for (const k of keys) {
    const v = num(fd, k)
    if (v == null || !Number.isFinite(v) || v < 0 || v > 100) return { error: 'Each limit must be between 0 and 100.' }
    rules[k] = v
  }
  await saveProfile(db, userId, { rules })
  await audit(db, userId, 'rules.updated', keys.map((k) => `${k} ${rules[k]}`).join(', '))
  refreshAll()
  return { error: null, ok: 'Rules saved.' }
}

export async function saveProfileAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { db, userId } = await ctx()
  const fields = { monthlyContribution: num(fd, 'monthlyContribution'), monthlyIncome: num(fd, 'monthlyIncome'), reportedPortfolio: num(fd, 'reportedPortfolio'), birthYear: num(fd, 'birthYear') }
  if (Object.values(fields).some((v) => bad(v) || (v != null && v < 0))) return { error: 'Amounts must be numbers, or blank.' }
  if (fields.birthYear != null && (fields.birthYear < 1900 || fields.birthYear > new Date().getFullYear())) return { error: 'Enter a four-digit birth year.' }
  const risk = str(fd, 'riskProfile')
  await saveProfile(db, userId, {
    ...fields,
    riskProfile: (oneOf(risk, RISK_PROFILES) as RiskProfile | null) ?? null,
    reportedPortfolioAsOf: isDate(str(fd, 'reportedPortfolioAsOf')) ? str(fd, 'reportedPortfolioAsOf') : null,
  })
  await audit(db, userId, 'profile.updated')
  refreshAll()
  return { error: null, ok: 'Profile saved.' }
}

export async function saveGoalAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { db, userId } = await ctx()
  const p = { meanReturnPct: num(fd, 'meanReturnPct'), volatilityPct: num(fd, 'volatilityPct'), inflationPct: num(fd, 'inflationPct'), feePct: num(fd, 'feePct') }
  const goalTarget = num(fd, 'goalTarget')
  const monthly = num(fd, 'monthlyContribution')
  if (Object.values(p).some((v) => v == null || !Number.isFinite(v)) || goalTarget == null || !Number.isFinite(goalTarget) || goalTarget <= 0 || bad(monthly)) return { error: 'Check the numbers and try again.' }
  if (p.volatilityPct! < 0 || p.volatilityPct! > 80 || p.meanReturnPct! < -20 || p.meanReturnPct! > 30 || p.feePct! < 0 || p.feePct! > 5) return { error: 'One of the assumptions is outside a sensible range.' }
  await saveProfile(db, userId, {
    projection: p as { meanReturnPct: number; volatilityPct: number; inflationPct: number; feePct: number },
    goalTarget,
    goalDate: isDate(str(fd, 'goalDate')) ? str(fd, 'goalDate') : null,
    ...(monthly != null ? { monthlyContribution: monthly } : {}),
  })
  await audit(db, userId, 'goal.updated', `Target ${goalTarget}`)
  refreshAll()
  return { error: null, ok: 'Saved as your defaults.' }
}

/* ---------- Journal ---------- */

export async function addTradeAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { db, userId } = await ctx()
  const symbol = normalizeSymbol(str(fd, 'symbol', 12))
  const type = oneOf(str(fd, 'type'), TRADE_TYPES) as TradeType | null
  const quantity = num(fd, 'quantity') ?? 0
  const price = num(fd, 'price') ?? 0
  const fees = num(fd, 'fees') ?? 0
  const tradeDate = str(fd, 'tradeDate')
  const account = str(fd, 'account', 80)
  if (!/^[A-Z0-9.\-]{1,12}$/.test(symbol)) return { error: 'Enter a ticker symbol.' }
  if (!type) return { error: 'Choose buy, sell, dividend or fee.' }
  if (!isDate(tradeDate)) return { error: 'Enter the trade date.' }
  if (![quantity, price, fees].every((n) => Number.isFinite(n) && n >= 0)) return { error: 'Quantity, price and fees must be numbers.' }
  if ((type === 'buy' || type === 'sell') && (quantity <= 0 || price <= 0)) return { error: 'A buy or sell needs a quantity and a price.' }
  if (type === 'dividend' && price <= 0) return { error: 'Enter the dividend amount received in the price field.' }

  let realizedGain: number | null = null
  let applied = false
  if ((type === 'buy' || type === 'sell') && fd.get('apply') === 'on') {
    const [h] = await db.select().from(holdings).where(and(eq(holdings.userId, userId), eq(holdings.account, account), eq(holdings.symbol, symbol)))
    let next
    try {
      next = applyTrade(h ? { quantity: h.quantity, avgCost: h.avgCost } : null, { type, quantity, price, fees })
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'That trade does not match your holding.' }
    }
    realizedGain = next.realizedGain
    if (h && next.quantity <= 1e-9) await db.delete(holdings).where(eq(holdings.id, h.id))
    else if (h) await db.update(holdings).set({ quantity: next.quantity, avgCost: next.avgCost, status: 'confirmed', asOf: tradeDate, updatedAt: new Date() }).where(eq(holdings.id, h.id))
    else {
      const c = classifySymbol(symbol)
      await db.insert(holdings).values({ userId, account, symbol, name: c.name ?? '', assetClass: c.assetClass, bucket: c.bucket, quantity: next.quantity, avgCost: next.avgCost, status: 'confirmed', asOf: tradeDate, purchaseDate: tradeDate })
    }
    applied = true
  }
  await db.insert(trades).values({
    userId,
    tradeDate,
    symbol,
    account,
    type,
    quantity,
    price,
    fees,
    realizedGain,
    appliedToHolding: applied,
    thesis: str(fd, 'thesis'),
    catalyst: str(fd, 'catalyst'),
    risk: str(fd, 'risk'),
    holdingPeriod: str(fd, 'holdingPeriod', 120),
    outcome: str(fd, 'outcome'),
    lessons: str(fd, 'lessons'),
  })
  await audit(db, userId, 'trade.logged', `${type} ${quantity} ${symbol} @ ${price}${applied ? ' (holding updated)' : ''}`)
  refreshAll()
  return { error: null, ok: applied ? `Logged, and your ${symbol} holding was updated.` : 'Logged.' }
}

export async function deleteTradeAction(fd: FormData): Promise<void> {
  const { db, userId } = await ctx()
  await db.delete(trades).where(and(eq(trades.id, str(fd, 'id')), eq(trades.userId, userId)))
  await audit(db, userId, 'trade.deleted', 'Journal entry removed; holdings were not changed')
  revalidatePath('/journal')
}

export async function addNoteAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { db, userId } = await ctx()
  const body = str(fd, 'body', 5000)
  if (!body) return { error: 'Write something first.' }
  const symbol = str(fd, 'symbol', 12) ? normalizeSymbol(str(fd, 'symbol', 12)) : ''
  await db.insert(notes).values({ userId, body, symbol, kind: str(fd, 'kind') === 'review' ? 'review' : 'note', noteDate: isDate(str(fd, 'noteDate')) ? str(fd, 'noteDate') : today() })
  revalidatePath('/journal')
  return { error: null, ok: 'Saved.' }
}

export async function deleteNoteAction(fd: FormData): Promise<void> {
  const { db, userId } = await ctx()
  await db.delete(notes).where(and(eq(notes.id, str(fd, 'id')), eq(notes.userId, userId)))
  revalidatePath('/journal')
}

export async function addWatchAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { db, userId } = await ctx()
  const symbol = normalizeSymbol(str(fd, 'symbol', 12))
  const targetPrice = num(fd, 'targetPrice')
  if (!/^[A-Z0-9.\-]{1,12}$/.test(symbol)) return { error: 'Enter a ticker symbol.' }
  if (bad(targetPrice)) return { error: 'The price to watch for must be a number.' }
  const values = { name: str(fd, 'name', 120) || classifySymbol(symbol).name || '', thesis: str(fd, 'thesis'), targetPrice }
  await db.insert(watchlist).values({ userId, symbol, ...values }).onConflictDoUpdate({ target: [watchlist.userId, watchlist.symbol], set: values })
  await refreshQuotes(db, [{ symbol, crypto: classifySymbol(symbol).assetClass === 'crypto' }], { finnhub: config.finnhubKey(), coingecko: config.coingeckoKey() }).catch(() => null)
  revalidatePath('/journal')
  return { error: null, ok: `${symbol} is on your watchlist.` }
}

export async function deleteWatchAction(fd: FormData): Promise<void> {
  const { db, userId } = await ctx()
  await db.delete(watchlist).where(and(eq(watchlist.id, str(fd, 'id')), eq(watchlist.userId, userId)))
  revalidatePath('/journal')
}

/* ---------- Data ---------- */

export async function deleteAllDataAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { db, userId } = await ctx()
  if (str(fd, 'confirm') !== 'DELETE') return { error: 'Type DELETE to confirm.' }
  await deleteAllData(db, userId)
  refreshAll()
  return { error: null, ok: 'All portfolio data was deleted.' }
}
