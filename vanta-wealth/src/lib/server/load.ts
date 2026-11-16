import 'server-only'
import { getDb } from '../db/client'
import { listHoldings, loadFeeds, loadOverview, recordSnapshot, refreshQuotes } from '../data/store'
import { config } from './config'
import { requireUserId } from './session'

/**
 * Loads the signed-in owner's overview, refreshing any price older than 15
 * minutes first. Provider failures never block the page; they are surfaced
 * through the feed status instead.
 */
export async function loadPage() {
  const userId = await requireUserId()
  const db = await getDb()
  const hs = await listHoldings(db, userId)
  await refreshQuotes(db, hs.map((h) => ({ symbol: h.symbol, crypto: h.assetClass === 'crypto' })), { finnhub: config.finnhubKey(), coingecko: config.coingeckoKey() }).catch(() => null)
  const overview = await loadOverview(db, userId)
  // Upserts today's row, so the latest valuation of the day is the one kept.
  await recordSnapshot(db, userId, overview)
  const feeds = await loadFeeds(db)
  const missingSymbols = (feeds.get('quotes:missing')?.error ?? '').split(',').filter((s) => s && hs.some((h) => h.symbol === s))
  const feedErrors = ['quotes:stocks', 'quotes:crypto'].map((k) => feeds.get(k)?.error).filter((e): e is string => !!e)
  return { userId, db, overview, feeds, missingSymbols, feedErrors }
}
