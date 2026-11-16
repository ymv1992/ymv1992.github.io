/**
 * Market-data providers. Each function returns exactly what the provider
 * sent or throws; nothing is estimated or filled in. `fetchImpl` is
 * injectable for tests.
 */
import { CRYPTO_IDS } from '../domain/reference'

type Fetch = typeof fetch

export interface ProviderQuote {
  symbol: string
  price: number
  prevClose: number | null
  quoteTime: Date | null
  source: string
}

export interface ProviderNews {
  symbol: string
  headline: string
  summary: string
  source: string
  url: string
  publishedAt: Date
}

export interface ProviderEarnings {
  symbol: string
  day: string
  hour: string
}

async function getJson(url: string, init: RequestInit, fetchImpl: Fetch, label: string): Promise<unknown> {
  const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(8000), cache: 'no-store' })
  if (res.status === 401 || res.status === 403) throw new Error(`${label} rejected the API key (HTTP ${res.status}).`)
  if (res.status === 429) throw new Error(`${label} rate limit reached. Try again in a minute.`)
  if (!res.ok) throw new Error(`${label} returned HTTP ${res.status}.`)
  return res.json()
}

// The base URLs can be overridden for automated tests against a local stand-in server.
const FINNHUB = process.env.FINNHUB_BASE_URL || 'https://finnhub.io/api/v1'
const COINGECKO = process.env.COINGECKO_BASE_URL || 'https://api.coingecko.com/api/v3'

/** Returns null when Finnhub has no price for the symbol (delisted, renamed or unsupported). */
export async function finnhubQuote(symbol: string, key: string, fetchImpl: Fetch = fetch): Promise<ProviderQuote | null> {
  const d = (await getJson(`${FINNHUB}/quote?symbol=${encodeURIComponent(symbol)}`, { headers: { 'X-Finnhub-Token': key } }, fetchImpl, 'Finnhub')) as {
    c?: number
    pc?: number
    t?: number
  }
  if (!d || typeof d.c !== 'number' || d.c <= 0) return null
  return { symbol, price: d.c, prevClose: typeof d.pc === 'number' && d.pc > 0 ? d.pc : null, quoteTime: d.t ? new Date(d.t * 1000) : null, source: 'Finnhub' }
}

export async function finnhubCompanyNews(symbol: string, from: string, to: string, key: string, fetchImpl: Fetch = fetch): Promise<ProviderNews[]> {
  const d = await getJson(`${FINNHUB}/company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}`, { headers: { 'X-Finnhub-Token': key } }, fetchImpl, 'Finnhub')
  if (!Array.isArray(d)) return []
  return (d as { headline?: string; summary?: string; source?: string; url?: string; datetime?: number }[])
    .filter((n) => n.headline && n.url && /^https?:\/\//.test(n.url) && n.datetime)
    .map((n) => ({ symbol, headline: n.headline!.slice(0, 300), summary: (n.summary ?? '').slice(0, 600), source: n.source ?? 'Unknown', url: n.url!, publishedAt: new Date(n.datetime! * 1000) }))
}

export async function finnhubEarnings(from: string, to: string, symbol: string, key: string, fetchImpl: Fetch = fetch): Promise<ProviderEarnings[]> {
  const d = (await getJson(`${FINNHUB}/calendar/earnings?from=${from}&to=${to}&symbol=${encodeURIComponent(symbol)}`, { headers: { 'X-Finnhub-Token': key } }, fetchImpl, 'Finnhub')) as {
    earningsCalendar?: { symbol?: string; date?: string; hour?: string }[]
  }
  return (d?.earningsCalendar ?? []).filter((e) => e.symbol && e.date && /^\d{4}-\d{2}-\d{2}$/.test(e.date)).map((e) => ({ symbol: e.symbol!, day: e.date!, hour: e.hour ?? '' }))
}

export async function finnhubProfileName(symbol: string, key: string, fetchImpl: Fetch = fetch): Promise<string | null> {
  const d = (await getJson(`${FINNHUB}/stock/profile2?symbol=${encodeURIComponent(symbol)}`, { headers: { 'X-Finnhub-Token': key } }, fetchImpl, 'Finnhub')) as { name?: string }
  return d?.name ? d.name.slice(0, 120) : null
}

/** CoinGecko public price endpoint. Works without a key at a low rate limit; a free demo key raises it. */
export async function coingeckoQuotes(symbols: string[], key: string | null, fetchImpl: Fetch = fetch): Promise<ProviderQuote[]> {
  const known = symbols.filter((s) => CRYPTO_IDS[s])
  if (!known.length) return []
  const ids = known.map((s) => CRYPTO_IDS[s]!.id).join(',')
  const d = (await getJson(
    `${COINGECKO}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true`,
    { headers: key ? { 'x-cg-demo-api-key': key } : {} },
    fetchImpl,
    'CoinGecko',
  )) as Record<string, { usd?: number; usd_24h_change?: number; last_updated_at?: number }>
  const out: ProviderQuote[] = []
  for (const s of known) {
    const row = d?.[CRYPTO_IDS[s]!.id]
    if (!row || typeof row.usd !== 'number' || row.usd <= 0) continue
    // CoinGecko reports a rolling 24-hour change rather than a previous close.
    const prev = typeof row.usd_24h_change === 'number' ? row.usd / (1 + row.usd_24h_change / 100) : null
    out.push({ symbol: s, price: row.usd, prevClose: prev, quoteTime: row.last_updated_at ? new Date(row.last_updated_at * 1000) : null, source: 'CoinGecko' })
  }
  return out
}
