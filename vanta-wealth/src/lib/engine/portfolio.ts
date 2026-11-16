import { BUCKETS, BUCKET_LABELS, INDEX_BUCKETS, THEME_BUCKETS, type AssetClass, type Bucket, type HoldingStatus, type RulesJson } from '../domain/types'

export interface HoldingInput {
  id: string
  symbol: string
  name: string
  assetClass: AssetClass
  bucket: Bucket
  quantity: number
  avgCost: number | null
  status: HoldingStatus
}

export interface QuoteInput {
  price: number
  prevClose: number | null
}

export interface Position extends HoldingInput {
  price: number | null
  /** Market value when priced, otherwise cost as a stand-in, otherwise null. */
  value: number | null
  valueBasis: 'market' | 'cost' | 'none'
  costBasis: number | null
  gain: number | null
  gainPct: number | null
  dayChange: number | null
  /** Share of the investable portfolio, 0–100. */
  weight: number | null
}

export interface ExtraAsset {
  name: string
  value: number
  bucket: Bucket | null
}

export interface PortfolioSummary {
  positions: Position[]
  /** Holdings plus any hand-entered assets flagged as part of the portfolio. */
  portfolioValue: number
  holdingsValue: number
  costBasis: number
  /** Gain across positions that have both a market price and a cost. */
  unrealizedGain: number
  unrealizedGainPct: number | null
  dayChange: number
  dayChangePct: number | null
  pricedCount: number
  atCostCount: number
  unvaluedCount: number
  byBucket: Record<Bucket, number>
  /** Value of in-portfolio assets with no bucket assigned. */
  unbucketed: number
}

/** Values every holding from the latest quotes. Missing prices are reported, never guessed. */
export function summarize(holdings: HoldingInput[], quotes: Map<string, QuoteInput>, extras: ExtraAsset[] = []): PortfolioSummary {
  const byBucket = Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<Bucket, number>
  let holdingsValue = 0
  let costBasis = 0
  let gain = 0
  let gainCost = 0
  let dayChange = 0
  let dayBase = 0
  let pricedCount = 0
  let atCostCount = 0
  let unvaluedCount = 0

  const positions: Position[] = holdings.map((h) => {
    const q = quotes.get(h.symbol)
    const price = q && q.price > 0 ? q.price : null
    const cost = h.avgCost != null ? h.avgCost * h.quantity : null
    let value: number | null = null
    let valueBasis: Position['valueBasis'] = 'none'
    if (price != null) {
      value = price * h.quantity
      valueBasis = 'market'
      pricedCount++
    } else if (cost != null) {
      value = cost
      valueBasis = 'cost'
      atCostCount++
    } else unvaluedCount++

    let g: number | null = null
    let gPct: number | null = null
    if (price != null && cost != null) {
      g = value! - cost
      gPct = cost > 0 ? (g / cost) * 100 : null
      gain += g
      gainCost += cost
    }
    let dc: number | null = null
    if (price != null && q?.prevClose != null && q.prevClose > 0) {
      dc = (price - q.prevClose) * h.quantity
      dayChange += dc
      dayBase += q.prevClose * h.quantity
    }
    if (cost != null) costBasis += cost
    if (value != null) {
      holdingsValue += value
      byBucket[h.bucket] += value
    }
    return { ...h, price, value, valueBasis, costBasis: cost, gain: g, gainPct: gPct, dayChange: dc, weight: null }
  })

  let portfolioValue = holdingsValue
  let unbucketed = 0
  for (const e of extras) {
    portfolioValue += e.value
    if (e.bucket) byBucket[e.bucket] += e.value
    else unbucketed += e.value
  }
  for (const p of positions) p.weight = p.value != null && portfolioValue > 0 ? (p.value / portfolioValue) * 100 : null

  return {
    positions,
    portfolioValue,
    holdingsValue,
    costBasis,
    unrealizedGain: gain,
    unrealizedGainPct: gainCost > 0 ? (gain / gainCost) * 100 : null,
    dayChange,
    dayChangePct: dayBase > 0 ? (dayChange / dayBase) * 100 : null,
    pricedCount,
    atCostCount,
    unvaluedCount,
    byBucket,
    unbucketed,
  }
}

export interface AllocationRow {
  bucket: Bucket
  value: number
  pct: number
  targetPct: number
  /** Target minus current, in percentage points. Positive means underweight. */
  gapPct: number
  /** Dollars needed to reach target at the current portfolio size. */
  gapValue: number
}

export function allocation(summary: PortfolioSummary, targets: Record<Bucket, number>): AllocationRow[] {
  const total = summary.portfolioValue
  return BUCKETS.map((bucket) => {
    const value = summary.byBucket[bucket]
    const pct = total > 0 ? (value / total) * 100 : 0
    const targetPct = targets[bucket] ?? 0
    return { bucket, value, pct, targetPct, gapPct: targetPct - pct, gapValue: ((targetPct - pct) / 100) * total }
  })
}

export interface RuleCheck {
  id: string
  label: string
  /** What was measured, as text. */
  measured: string
  limit: string
  broken: boolean
}

/** Checks the owner's own rules against the current mix. Pure arithmetic on recorded values. */
export function checkRules(summary: PortfolioSummary, rules: RulesJson): RuleCheck[] {
  const total = summary.portfolioValue
  const pct = (v: number) => (total > 0 ? (v / total) * 100 : 0)
  const f = (n: number) => `${n.toFixed(1)}%`
  const out: RuleCheck[] = []

  // Funds are diversified by design, so the single-position limit applies to individual stocks and coins.
  const singles = summary.positions.filter((p) => p.assetClass !== 'etf' && p.weight != null).sort((a, b) => b.weight! - a.weight!)
  const over = singles.filter((p) => p.weight! > rules.maxSingleStockPct)
  out.push({
    id: 'single',
    label: `No single stock or coin above ${rules.maxSingleStockPct}%`,
    measured: over.length ? over.map((p) => `${p.symbol} ${f(p.weight!)}`).join(', ') : singles[0] ? `Largest: ${singles[0].symbol} ${f(singles[0].weight!)}` : 'No positions',
    limit: f(rules.maxSingleStockPct),
    broken: over.length > 0,
  })

  const themes = THEME_BUCKETS.map((b) => ({ b, p: pct(summary.byBucket[b]) })).sort((a, b) => b.p - a.p)
  const overThemes = themes.filter((t) => t.p > rules.maxThemePct)
  out.push({
    id: 'theme',
    label: `No theme above ${rules.maxThemePct}%`,
    measured: (overThemes.length ? overThemes : themes.slice(0, 1)).map((t) => `${BUCKET_LABELS[t.b]} ${f(t.p)}`).join(', '),
    limit: f(rules.maxThemePct),
    broken: overThemes.length > 0,
  })

  const indexPct = pct(INDEX_BUCKETS.reduce((s, b) => s + summary.byBucket[b], 0))
  out.push({ id: 'index', label: `At least ${rules.minIndexPct}% in index funds`, measured: f(indexPct), limit: f(rules.minIndexPct), broken: total > 0 && indexPct < rules.minIndexPct })

  const spec = pct(summary.byBucket.speculative)
  out.push({ id: 'speculative', label: `Speculative under ${rules.maxSpeculativePct}%`, measured: f(spec), limit: f(rules.maxSpeculativePct), broken: spec > rules.maxSpeculativePct })

  const crypto = pct(summary.byBucket.crypto)
  out.push({ id: 'crypto', label: `Crypto under ${rules.maxCryptoPct}%`, measured: f(crypto), limit: f(rules.maxCryptoPct), broken: crypto > rules.maxCryptoPct })
  return out
}

/**
 * Months of contributions until the largest N positions together fall under a
 * chosen share, assuming prices stay flat and every new dollar goes elsewhere.
 * Returns 0 if already under, null if it never happens (no contribution).
 */
export function monthsUntilTopUnder(topValue: number, total: number, limitPct: number, monthly: number, trim = 0): number | null {
  if (total <= 0 || limitPct <= 0) return null
  // A trim moves money out of the top positions but keeps it in the portfolio.
  const top = Math.max(0, topValue - trim)
  const limit = limitPct / 100
  if (top / total <= limit) return 0
  if (monthly <= 0) return null
  return Math.ceil((top / limit - total) / monthly)
}

export interface HealthPart {
  label: string
  score: number
  max: number
  detail: string
}

/**
 * Transparent 0–100 checklist score. It measures how closely the portfolio
 * follows the owner's own rules and targets. It does not predict returns.
 */
export function healthScore(summary: PortfolioSummary, rows: AllocationRow[], rules: RuleCheck[], unverifiedCount: number): { total: number; parts: HealthPart[] } {
  const parts: HealthPart[] = []
  const kept = rules.filter((r) => !r.broken).length
  parts.push({ label: 'Your rules kept', score: Math.round((kept / Math.max(1, rules.length)) * 40), max: 40, detail: `${kept} of ${rules.length} rules pass` })
  const drift = rows.reduce((s, r) => s + Math.abs(r.gapPct), 0) / 2
  parts.push({ label: 'Closeness to target mix', score: Math.round(Math.max(0, 1 - drift / 50) * 30), max: 30, detail: `${drift.toFixed(0)}% of the portfolio would need to move to match targets` })
  const top = [...summary.positions].filter((p) => p.assetClass !== 'etf').sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0)).slice(0, 3)
  const top3 = top.reduce((s, p) => s + (p.weight ?? 0), 0)
  parts.push({ label: 'Concentration', score: Math.round(Math.max(0, 1 - Math.max(0, top3 - 20) / 60) * 20), max: 20, detail: `Top 3 individual positions are ${top3.toFixed(0)}% of the portfolio` })
  const n = summary.positions.length
  parts.push({ label: 'Data verified', score: n ? Math.round(((n - unverifiedCount) / n) * 10) : 0, max: 10, detail: `${n - unverifiedCount} of ${n} holdings confirmed` })
  return { total: parts.reduce((s, p) => s + p.score, 0), parts }
}

/** Average-cost bookkeeping for a logged trade. */
export function applyTrade(
  current: { quantity: number; avgCost: number | null } | null,
  trade: { type: 'buy' | 'sell'; quantity: number; price: number; fees: number },
): { quantity: number; avgCost: number | null; realizedGain: number | null } {
  const qty = current?.quantity ?? 0
  const avg = current?.avgCost ?? null
  if (trade.type === 'buy') {
    const newQty = qty + trade.quantity
    // Fees are part of the cost of the shares bought.
    const cost = trade.quantity * trade.price + trade.fees
    const newAvg = qty === 0 ? cost / trade.quantity : avg != null ? (qty * avg + cost) / newQty : null
    return { quantity: newQty, avgCost: newAvg, realizedGain: null }
  }
  if (trade.quantity > qty + 1e-9) throw new Error(`Cannot sell ${trade.quantity}: only ${qty} held.`)
  const realizedGain = avg != null ? (trade.price - avg) * trade.quantity - trade.fees : null
  return { quantity: Math.max(0, qty - trade.quantity), avgCost: avg, realizedGain }
}
