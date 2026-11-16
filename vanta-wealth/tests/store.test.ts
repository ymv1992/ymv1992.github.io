import { beforeAll, describe, expect, it } from 'vitest'
import { createPgliteDb, type AppDb } from '@/lib/db/client'
import { holdings, manualAssets, trades } from '@/lib/db/schema'
import { deleteAllData, ensureOwner, exportAll, listSnapshots, loadNews, loadOverview, loadProfile, realizedGainTotal, recordSnapshot, refreshNews, refreshQuotes, saveProfile } from '@/lib/data/store'
import { buildBriefing, tagHeadline, washSaleFlags } from '@/lib/view/briefing'

/** Stand-in for the provider APIs, returning fixed fixture values. */
function fakeFetch(opts: { failStocks?: boolean } = {}): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
    if (url.includes('/quote?')) {
      if (opts.failStocks) return json({}, 429)
      const symbol = new URL(url).searchParams.get('symbol')
      if (symbol === 'GONE') return json({ c: 0, pc: 0, t: 0 })
      return json({ c: symbol === 'AAA' ? 120 : 50, pc: symbol === 'AAA' ? 100 : 50, t: 1794844800 })
    }
    if (url.includes('/simple/price')) return json({ bitcoin: { usd: 1000, usd_24h_change: 25, last_updated_at: 1794844800 } })
    if (url.includes('/company-news')) return json([{ headline: 'AAA beats on quarterly results', summary: 's', source: 'Wire', url: 'https://example.com/a', datetime: 1794844800 }, { headline: 'bad', url: 'javascript:alert(1)', datetime: 1 }])
    if (url.includes('/calendar/earnings')) return json({ earningsCalendar: [{ symbol: 'AAA', date: '2026-11-20', hour: 'amc' }] })
    return json({}, 404)
  }) as typeof fetch
}

const now = new Date('2026-11-16T15:00:00Z')
let db: AppDb
let userId: string

beforeAll(async () => {
  db = await createPgliteDb()
  userId = await ensureOwner(db, 'Owner@Example.com')
  await db.insert(holdings).values([
    { userId, symbol: 'AAA', assetClass: 'stock', bucket: 'ai_big_tech', quantity: 10, avgCost: 80, status: 'confirmed' },
    { userId, symbol: 'VTI', assetClass: 'etf', bucket: 'us_index', quantity: 2, avgCost: 40, status: 'confirmed' },
    { userId, symbol: 'GONE', assetClass: 'stock', bucket: 'speculative', quantity: 1, avgCost: 10, status: 'unverified' },
    { userId, symbol: 'BTC', assetClass: 'crypto', bucket: 'crypto', quantity: 0.5, avgCost: null, status: 'confirmed' },
  ])
  await db.insert(manualAssets).values([
    { userId, name: 'Retirement', category: 'retirement', value: 1000, inPortfolio: true, bucket: 'us_index', liquid: false },
    { userId, name: 'Home', category: 'real_estate', value: 5000, liability: 3000 },
    { userId, name: 'Pending', category: 'retirement', value: null, inPortfolio: true, status: 'needs_input' },
  ])
})

describe('store', () => {
  it('owner account is created once, case-insensitively', async () => {
    expect(await ensureOwner(db, 'owner@example.com')).toBe(userId)
  })

  it('without a key, stocks are skipped and nothing is invented', async () => {
    const items = [{ symbol: 'AAA', crypto: false }]
    const r = await refreshQuotes(db, items, { finnhub: null, coingecko: null }, { now, fetchImpl: fakeFetch() })
    expect(r).toMatchObject({ updated: 0, skipped: ['AAA'] })
    const o = await loadOverview(db, userId)
    expect(o.summary.pricedCount).toBe(0)
    expect(o.summary.positions.find((p) => p.symbol === 'AAA')!.valueBasis).toBe('cost')
  })

  it('stores provider prices, reports missing symbols, and respects the refresh interval', async () => {
    const items = [
      { symbol: 'AAA', crypto: false },
      { symbol: 'VTI', crypto: false },
      { symbol: 'GONE', crypto: false },
      { symbol: 'BTC', crypto: true },
    ]
    const keys = { finnhub: 'k', coingecko: null }
    const r = await refreshQuotes(db, items, keys, { now, fetchImpl: fakeFetch() })
    expect(r.updated).toBe(3)
    expect(r.missing).toEqual(['GONE'])
    const again = await refreshQuotes(db, items.slice(0, 2), keys, { now: new Date(now.getTime() + 60_000), fetchImpl: fakeFetch({ failStocks: true }) })
    expect(again).toMatchObject({ updated: 0, errors: [] })
    const failed = await refreshQuotes(db, items.slice(0, 2), keys, { now: new Date(now.getTime() + 3_600_000), fetchImpl: fakeFetch({ failStocks: true }) })
    expect(failed.updated).toBe(0)
    expect(failed.errors[0]).toMatch(/rate limit/)

    const o = await loadOverview(db, userId)
    // Old prices survive a failed refresh.
    expect(o.quotes.get('AAA')!.price).toBe(120)
    expect(o.quotes.get('BTC')!.prevClose).toBeCloseTo(800)
    // 1200 + 100 + 10 (at cost) + 500 crypto; plus 1000 retirement in the portfolio.
    expect(o.summary.holdingsValue).toBe(1810)
    expect(o.summary.portfolioValue).toBe(2810)
    // Property equity (5000 - 3000) counts toward net worth only.
    expect(o.netWorth).toBe(2810 + 5000 - 3000)
    expect(o.liquid).toBe(1810)
    expect(o.realEstateEquity).toBe(2000)
    expect(o.needsInput.map((a) => a.name)).toEqual(['Pending'])
    expect(o.unverified).toBe(1)
    expect(o.summary.byBucket.us_index).toBe(1100)

    await recordSnapshot(db, userId, o, now)
    await recordSnapshot(db, userId, o, now)
    const snaps = await listSnapshots(db, userId)
    expect(snaps).toHaveLength(1)
    expect(snaps[0]).toMatchObject({ day: '2026-11-16', portfolioValue: 2810, complete: false })

    const briefing = buildBriefing(o, { finnhub: true, missingSymbols: ['GONE'], earnings: [{ symbol: 'AAA', day: '2026-11-20' }], today: '2026-11-16' })
    const titles = briefing.map((b) => b.title).join(' | ')
    expect(titles).toContain('No price found for GONE')
    expect(titles).toContain('AAA moved +20.0%')
    expect(titles).toContain('Earnings this week: AAA')
    expect(titles).toContain('Enter a value for Pending')
    expect(titles).toContain('Rule broken')
    expect(briefing[0]!.level).toBe('action')
  })

  it('news and earnings are stored once with safe links only', async () => {
    expect((await refreshNews(db, ['AAA'], null, { now })).ran).toBe(false)
    expect((await refreshNews(db, ['AAA'], 'k', { now, fetchImpl: fakeFetch() })).ran).toBe(true)
    expect((await refreshNews(db, ['AAA'], 'k', { now, fetchImpl: fakeFetch() })).ran).toBe(false)
    await refreshNews(db, ['AAA'], 'k', { now, force: true, fetchImpl: fakeFetch() })
    const { news, earnings } = await loadNews(db, ['AAA'], now)
    expect(news).toHaveLength(1)
    expect(news[0]!.url).toBe('https://example.com/a')
    expect(earnings).toHaveLength(1)
    expect(tagHeadline(news[0]!.headline)).toBe('Earnings')
    expect(tagHeadline('Company opens new office')).toBe('General')
  })

  it('profile merges defaults; realized totals; wash-sale flags', async () => {
    await saveProfile(db, userId, { monthlyContribution: 500 })
    const p = await loadProfile(db, userId)
    expect(p.monthlyContribution).toBe(500)
    expect(p.targets.us_index).toBe(35)
    await db.insert(trades).values([
      { userId, tradeDate: '2026-10-01', symbol: 'AAA', type: 'sell', quantity: 1, price: 70, realizedGain: -10 },
      { userId, tradeDate: '2026-10-15', symbol: 'AAA', type: 'buy', quantity: 1, price: 72 },
      { userId, tradeDate: '2026-06-01', symbol: 'VTI', type: 'sell', quantity: 1, price: 60, realizedGain: 20, fees: 1 },
      { userId, tradeDate: '2026-06-02', symbol: 'VTI', type: 'dividend', quantity: 0, price: 3.5 },
    ])
    expect(await realizedGainTotal(db, userId)).toEqual({ realized: 10, dividends: 3.5, fees: 1 })
    const all = (await exportAll(db, userId)).trades
    expect(washSaleFlags(all)).toEqual([{ symbol: 'AAA', sellDate: '2026-10-01', buyDate: '2026-10-15', loss: -10 }])
  })

  it('delete removes everything the owner entered', async () => {
    await deleteAllData(db, userId)
    const e = await exportAll(db, userId)
    expect([e.holdings.length, e.otherAssets.length, e.trades.length, e.snapshots.length]).toEqual([0, 0, 0, 0])
    expect(e.profile.monthlyContribution).toBeNull()
  })
})
