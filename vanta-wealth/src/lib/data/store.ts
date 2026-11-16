import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import type { AppDb } from '../db/client'
import { auditLog, earningsEvents, feedState, holdings, manualAssets, newsItems, notes, profiles, quotes, snapshots, trades, users, watchlist } from '../db/schema'
import { DEFAULT_PROFILE, type ProfileJson } from '../domain/types'
import { allocation, checkRules, healthScore, summarize, type ExtraAsset } from '../engine/portfolio'
import { coingeckoQuotes, finnhubCompanyNews, finnhubEarnings, finnhubQuote, type ProviderQuote } from '../providers/market'
import { isoDay } from '../time'

export async function ensureOwner(db: AppDb, email: string): Promise<string> {
  const identifier = email.trim().toLowerCase()
  await db.insert(users).values({ authIdentifier: identifier }).onConflictDoNothing()
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.authIdentifier, identifier))
  await db.insert(profiles).values({ userId: user!.id, data: DEFAULT_PROFILE }).onConflictDoNothing()
  return user!.id
}

export async function loadProfile(db: AppDb, userId: string): Promise<ProfileJson> {
  const [row] = await db.select().from(profiles).where(eq(profiles.userId, userId))
  const d = row?.data
  // Merge with defaults so fields added in later versions always exist.
  return { ...DEFAULT_PROFILE, ...d, targets: { ...DEFAULT_PROFILE.targets, ...d?.targets }, rules: { ...DEFAULT_PROFILE.rules, ...d?.rules }, projection: { ...DEFAULT_PROFILE.projection, ...d?.projection } }
}

export async function saveProfile(db: AppDb, userId: string, patch: Partial<ProfileJson>): Promise<void> {
  const next = { ...(await loadProfile(db, userId)), ...patch }
  await db.insert(profiles).values({ userId, data: next }).onConflictDoUpdate({ target: profiles.userId, set: { data: next, updatedAt: new Date() } })
}

export async function audit(db: AppDb, userId: string, action: string, detail = ''): Promise<void> {
  await db.insert(auditLog).values({ userId, action, detail: detail.slice(0, 500) })
}

export const listHoldings = (db: AppDb, userId: string) => db.select().from(holdings).where(eq(holdings.userId, userId)).orderBy(asc(holdings.symbol))
export const listAssets = (db: AppDb, userId: string) => db.select().from(manualAssets).where(eq(manualAssets.userId, userId)).orderBy(asc(manualAssets.createdAt))
export const listWatchlist = (db: AppDb, userId: string) => db.select().from(watchlist).where(eq(watchlist.userId, userId)).orderBy(asc(watchlist.symbol))
export const listTrades = (db: AppDb, userId: string) => db.select().from(trades).where(eq(trades.userId, userId)).orderBy(desc(trades.tradeDate), desc(trades.createdAt))
export const listNotes = (db: AppDb, userId: string) => db.select().from(notes).where(eq(notes.userId, userId)).orderBy(desc(notes.noteDate), desc(notes.createdAt))
export const listSnapshots = (db: AppDb, userId: string) => db.select().from(snapshots).where(eq(snapshots.userId, userId)).orderBy(asc(snapshots.day))
export const listAudit = (db: AppDb, userId: string, limit = 30) => db.select().from(auditLog).where(eq(auditLog.userId, userId)).orderBy(desc(auditLog.createdAt)).limit(limit)

export type HoldingRow = Awaited<ReturnType<typeof listHoldings>>[number]
export type AssetRow = Awaited<ReturnType<typeof listAssets>>[number]
export type QuoteRow = typeof quotes.$inferSelect

export async function loadQuotes(db: AppDb, symbols: string[]): Promise<Map<string, QuoteRow>> {
  if (!symbols.length) return new Map()
  const rows = await db.select().from(quotes).where(inArray(quotes.symbol, symbols))
  return new Map(rows.map((r) => [r.symbol, r]))
}

async function setFeed(db: AppDb, key: string, error: string | null, now: Date) {
  await db.insert(feedState).values({ key, fetchedAt: now, error }).onConflictDoUpdate({ target: feedState.key, set: { fetchedAt: now, error } })
}

export async function loadFeeds(db: AppDb): Promise<Map<string, { fetchedAt: Date; error: string | null }>> {
  const rows = await db.select().from(feedState)
  return new Map(rows.map((r) => [r.key, r]))
}

export interface Keys {
  finnhub: string | null
  coingecko: string | null
}

export interface RefreshResult {
  updated: number
  /** Symbols the provider had no price for. */
  missing: string[]
  errors: string[]
  skipped: string[]
}

export const QUOTE_TTL_MINUTES = 15

/**
 * Fetches prices for the given symbols and stores exactly what the providers
 * return. Symbols without a price are reported as missing; old prices are
 * kept with their original timestamps so staleness stays visible.
 */
export async function refreshQuotes(
  db: AppDb,
  items: { symbol: string; crypto: boolean }[],
  keys: Keys,
  opts: { force?: boolean; now?: Date; fetchImpl?: typeof fetch } = {},
): Promise<RefreshResult> {
  const now = opts.now ?? new Date()
  const result: RefreshResult = { updated: 0, missing: [], errors: [], skipped: [] }
  const unique = [...new Map(items.map((i) => [i.symbol, i])).values()]
  const existing = await loadQuotes(db, unique.map((i) => i.symbol))
  const due = unique.filter((i) => opts.force || !existing.get(i.symbol) || now.getTime() - existing.get(i.symbol)!.fetchedAt.getTime() > QUOTE_TTL_MINUTES * 60_000)
  if (!due.length) return result
  const got: ProviderQuote[] = []

  const stocks = due.filter((i) => !i.crypto).map((i) => i.symbol)
  if (stocks.length) {
    if (!keys.finnhub) result.skipped.push(...stocks)
    else {
      const settled = await Promise.allSettled(stocks.map((s) => finnhubQuote(s, keys.finnhub!, opts.fetchImpl)))
      const errs = new Set<string>()
      settled.forEach((r, i) => {
        if (r.status === 'rejected') errs.add(r.reason instanceof Error ? r.reason.message : 'Finnhub request failed.')
        else if (r.value) got.push(r.value)
        else result.missing.push(stocks[i]!)
      })
      result.errors.push(...errs)
      await setFeed(db, 'quotes:stocks', errs.size ? [...errs].join(' ') : null, now)
    }
  }
  const coins = due.filter((i) => i.crypto).map((i) => i.symbol)
  if (coins.length) {
    try {
      const q = await coingeckoQuotes(coins, keys.coingecko, opts.fetchImpl)
      got.push(...q)
      result.missing.push(...coins.filter((c) => !q.some((x) => x.symbol === c)))
      await setFeed(db, 'quotes:crypto', null, now)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'CoinGecko request failed.'
      result.errors.push(msg)
      await setFeed(db, 'quotes:crypto', msg, now)
    }
  }
  for (const q of got) {
    const row = { symbol: q.symbol, price: q.price, prevClose: q.prevClose, quoteTime: q.quoteTime, fetchedAt: now, source: q.source }
    await db.insert(quotes).values(row).onConflictDoUpdate({ target: quotes.symbol, set: row })
  }
  await setFeed(db, 'quotes:missing', result.missing.length ? result.missing.join(',') : null, now)
  result.updated = got.length
  return result
}

/** Everything the dashboard pages need, computed from stored records and the latest quotes. */
export async function loadOverview(db: AppDb, userId: string) {
  const [profile, hs, assets] = await Promise.all([loadProfile(db, userId), listHoldings(db, userId), listAssets(db, userId)])
  const quoteRows = await loadQuotes(db, hs.map((h) => h.symbol))
  const extras: ExtraAsset[] = assets.filter((a) => a.inPortfolio && a.value != null).map((a) => ({ name: a.name, value: a.value!, bucket: a.bucket }))
  const summary = summarize(hs, quoteRows, extras)
  const rows = allocation(summary, profile.targets)
  const rules = checkRules(summary, profile.rules)
  const unverified = hs.filter((h) => h.status !== 'confirmed').length
  const health = healthScore(summary, rows, rules, unverified)

  const otherAssets = assets.filter((a) => !a.inPortfolio && a.value != null).reduce((s, a) => s + a.value!, 0)
  const liabilities = assets.reduce((s, a) => s + (a.liability ?? 0), 0)
  const netWorth = summary.portfolioValue + otherAssets - liabilities
  const liquid = summary.holdingsValue + assets.filter((a) => a.liquid && a.value != null).reduce((s, a) => s + a.value!, 0)
  const realEstateEquity = assets.filter((a) => a.category === 'real_estate').reduce((s, a) => s + (a.value ?? 0) - a.liability, 0)
  const needsInput = assets.filter((a) => a.value == null)

  return { profile, holdings: hs, assets, quotes: quoteRows, summary, rows, rules, health, unverified, netWorth, liquid, liabilities, realEstateEquity, needsInput }
}

export type Overview = Awaited<ReturnType<typeof loadOverview>>

/** Stores today's valuation once holdings are priced. Days are never back-filled. */
export async function recordSnapshot(db: AppDb, userId: string, o: Overview, now = new Date()): Promise<void> {
  if (!o.holdings.length || o.summary.pricedCount === 0) return
  const day = isoDay(0, now)
  const row = {
    userId,
    day,
    portfolioValue: o.summary.portfolioValue,
    costBasis: o.summary.costBasis || null,
    netWorth: o.netWorth,
    complete: o.summary.atCostCount === 0 && o.summary.unvaluedCount === 0,
  }
  await db.insert(snapshots).values(row).onConflictDoUpdate({ target: [snapshots.userId, snapshots.day], set: row })
}

export const NEWS_TTL_MINUTES = 60

/** Pulls recent company news and upcoming earnings dates for the given stock symbols. */
export async function refreshNews(db: AppDb, symbols: string[], key: string | null, opts: { force?: boolean; now?: Date; fetchImpl?: typeof fetch } = {}): Promise<{ errors: string[]; ran: boolean }> {
  const now = opts.now ?? new Date()
  if (!key || !symbols.length) return { errors: [], ran: false }
  const feeds = await loadFeeds(db)
  const last = feeds.get('news')
  if (!opts.force && last && now.getTime() - last.fetchedAt.getTime() < NEWS_TTL_MINUTES * 60_000) return { errors: [], ran: false }
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const from = iso(new Date(now.getTime() - 7 * 86_400_000))
  const ahead = iso(new Date(now.getTime() + 45 * 86_400_000))
  const errs = new Set<string>()
  for (const s of symbols) {
    try {
      const items = (await finnhubCompanyNews(s, from, iso(now), key, opts.fetchImpl)).sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime()).slice(0, 8)
      if (items.length) await db.insert(newsItems).values(items.map((n) => ({ ...n, fetchedAt: now }))).onConflictDoNothing()
      const earnings = await finnhubEarnings(iso(now), ahead, s, key, opts.fetchImpl)
      await db.delete(earningsEvents).where(and(eq(earningsEvents.symbol, s), gte(earningsEvents.day, iso(now))))
      if (earnings.length) await db.insert(earningsEvents).values(earnings.map((e) => ({ ...e, symbol: s, fetchedAt: now }))).onConflictDoNothing()
    } catch (err) {
      errs.add(err instanceof Error ? err.message : 'Finnhub request failed.')
    }
  }
  await db.delete(newsItems).where(lt(newsItems.publishedAt, new Date(now.getTime() - 30 * 86_400_000)))
  await setFeed(db, 'news', errs.size ? [...errs].join(' ') : null, now)
  return { errors: [...errs], ran: true }
}

export async function loadNews(db: AppDb, symbols: string[], now = new Date()) {
  if (!symbols.length) return { news: [], earnings: [] }
  const news = await db.select().from(newsItems).where(inArray(newsItems.symbol, symbols)).orderBy(desc(newsItems.publishedAt)).limit(200)
  const earnings = await db
    .select()
    .from(earningsEvents)
    .where(and(inArray(earningsEvents.symbol, symbols), gte(earningsEvents.day, now.toISOString().slice(0, 10))))
    .orderBy(asc(earningsEvents.day))
  return { news, earnings }
}

export async function exportAll(db: AppDb, userId: string) {
  const [profile, hs, assets, wl, tr, ns, snaps, log] = await Promise.all([
    loadProfile(db, userId),
    listHoldings(db, userId),
    listAssets(db, userId),
    listWatchlist(db, userId),
    listTrades(db, userId),
    listNotes(db, userId),
    listSnapshots(db, userId),
    listAudit(db, userId, 1000),
  ])
  return { exportedAt: new Date().toISOString(), profile, holdings: hs, otherAssets: assets, watchlist: wl, trades: tr, notes: ns, snapshots: snaps, auditLog: log }
}

/** Removes every record the owner entered. The sign-in account itself is kept. */
export async function deleteAllData(db: AppDb, userId: string): Promise<void> {
  for (const t of [holdings, manualAssets, watchlist, trades, notes, snapshots, auditLog]) await db.delete(t).where(eq(t.userId, userId))
  await db.update(profiles).set({ data: DEFAULT_PROFILE, updatedAt: new Date() }).where(eq(profiles.userId, userId))
  await audit(db, userId, 'data.deleted', 'All portfolio data deleted by owner')
}

export async function realizedGainTotal(db: AppDb, userId: string): Promise<{ realized: number; dividends: number; fees: number }> {
  const [r] = await db
    .select({
      realized: sql<number>`coalesce(sum(${trades.realizedGain}), 0)::float8`,
      dividends: sql<number>`coalesce(sum(case when ${trades.type} = 'dividend' then ${trades.price} * (case when ${trades.quantity} > 0 then ${trades.quantity} else 1 end) else 0 end), 0)::float8`,
      fees: sql<number>`coalesce(sum(${trades.fees}), 0)::float8`,
    })
    .from(trades)
    .where(eq(trades.userId, userId))
  return { realized: Number(r?.realized ?? 0), dividends: Number(r?.dividends ?? 0), fees: Number(r?.fees ?? 0) }
}
