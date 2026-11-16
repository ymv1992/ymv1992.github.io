import type { Overview } from '../data/store'
import { BUCKET_LABELS } from '../domain/types'

export interface BriefingItem {
  level: 'action' | 'watch' | 'info'
  title: string
  detail: string
  href?: string
}

export interface BriefingContext {
  finnhub: boolean
  /** Symbols the price provider returned nothing for. */
  missingSymbols: string[]
  earnings: { symbol: string; day: string }[]
  today: string
  moveThresholdPct?: number
}

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

/**
 * Rule-based briefing. Every item is produced by a stated condition on the
 * owner's recorded data, so it can always be traced back to a number.
 * Routine movement is left out on purpose.
 */
export function buildBriefing(o: Overview, c: BriefingContext): BriefingItem[] {
  const items: BriefingItem[] = []
  const s = o.summary
  if (!o.holdings.length) {
    return [{ level: 'action', title: 'Add your holdings', detail: 'Paste or type what you own to start tracking. Nothing is shown until you enter it.', href: '/portfolio#import' }]
  }

  const stocks = o.holdings.filter((h) => h.assetClass !== 'crypto').length
  if (stocks > 0 && !c.finnhub) items.push({ level: 'action', title: 'Stock prices are not connected', detail: `${stocks} stock and fund holdings are shown at cost until a free market-data key is added.`, href: '/settings#data' })
  if (c.missingSymbols.length) items.push({ level: 'action', title: `No price found for ${c.missingSymbols.join(', ')}`, detail: 'The ticker may have changed, been delisted or merged. Check your brokerage statement and update the symbol.', href: '/portfolio' })
  if (s.unvaluedCount > 0) items.push({ level: 'watch', title: `${s.unvaluedCount} holding${s.unvaluedCount > 1 ? 's have' : ' has'} no value yet`, detail: 'Holdings with neither a price nor a cost are left out of totals rather than estimated.', href: '/portfolio' })

  for (const r of o.rules.filter((r) => r.broken)) items.push({ level: 'action', title: `Rule broken: ${r.label}`, detail: `Measured: ${r.measured}.`, href: '/strategy' })

  const threshold = c.moveThresholdPct ?? 5
  const movers = s.positions
    .map((p) => ({ p, q: o.quotes.get(p.symbol) }))
    .filter(({ p, q }) => p.price != null && q?.prevClose && Math.abs((p.price - q.prevClose) / q.prevClose) * 100 >= threshold)
  for (const { p, q } of movers) {
    const move = ((p.price! - q!.prevClose!) / q!.prevClose!) * 100
    items.push({ level: 'watch', title: `${p.symbol} moved ${move > 0 ? '+' : '−'}${Math.abs(move).toFixed(1)}%`, detail: `That is ${usd(Math.abs(p.dayChange ?? 0))} on your position. Check the news before deciding whether anything has changed.`, href: '/news' })
  }

  const soon = c.earnings.filter((e) => e.day >= c.today && (new Date(e.day).getTime() - new Date(c.today).getTime()) / 86_400_000 <= 7)
  if (soon.length) items.push({ level: 'watch', title: `Earnings this week: ${[...new Set(soon.map((e) => e.symbol))].join(', ')}`, detail: 'Prices often move sharply around earnings reports.', href: '/news' })

  if (o.unverified > 0) items.push({ level: 'watch', title: `${o.unverified} holding${o.unverified > 1 ? 's' : ''} still unverified`, detail: 'Compare each one with your brokerage statement, then mark it confirmed.', href: '/portfolio' })
  if (o.needsInput.length) items.push({ level: 'action', title: `Enter a value for ${o.needsInput.map((a) => a.name).join(', ')}`, detail: 'Until a value is entered, it is left out of net worth and allocation.', href: '/portfolio#assets' })
  if (!o.assets.some((a) => a.category === 'retirement')) items.push({ level: 'info', title: 'Add retirement accounts', detail: 'A TSP, 401k or IRA is usually a large share of total investments. Add it so your mix and progress reflect everything you own.', href: '/portfolio#assets' })

  const gap = [...o.rows].sort((a, b) => b.gapValue - a.gapValue)[0]
  if (gap && gap.gapPct > 2 && s.portfolioValue > 0) items.push({ level: 'info', title: `Largest gap to your target: ${BUCKET_LABELS[gap.bucket]}`, detail: `${gap.pct.toFixed(1)}% now against a ${gap.targetPct}% target, about ${usd(gap.gapValue)} short.`, href: '/strategy' })

  if (o.profile.monthlyContribution == null) items.push({ level: 'info', title: 'Set your monthly contribution', detail: 'Projections and the diversification plan use it.', href: '/settings' })
  if (!o.profile.riskProfile) items.push({ level: 'info', title: 'Choose a risk profile', detail: 'None is assumed for you. Pick the one that fits in Settings.', href: '/settings' })

  const order = { action: 0, watch: 1, info: 2 }
  return items.sort((a, b) => order[a.level] - order[b.level])
}

export interface WashSaleFlag {
  symbol: string
  sellDate: string
  buyDate: string
  loss: number
}

/** A loss sale with a purchase of the same symbol within 30 days either side may be a wash sale. */
export function washSaleFlags(trades: { symbol: string; type: string; tradeDate: string; realizedGain: number | null }[]): WashSaleFlag[] {
  const out: WashSaleFlag[] = []
  for (const sell of trades.filter((t) => t.type === 'sell' && t.realizedGain != null && t.realizedGain < 0)) {
    const buy = trades.find((b) => b.type === 'buy' && b.symbol === sell.symbol && Math.abs(new Date(b.tradeDate).getTime() - new Date(sell.tradeDate).getTime()) <= 30 * 86_400_000)
    if (buy) out.push({ symbol: sell.symbol, sellDate: sell.tradeDate, buyDate: buy.tradeDate, loss: sell.realizedGain! })
  }
  return out
}

const TAGS: [string, RegExp][] = [
  ['Earnings', /\b(earnings|quarter(ly)? results|q[1-4]\b|revenue|eps|guidance|outlook)\b/i],
  ['Analyst', /\b(upgrade[sd]?|downgrade[sd]?|price target|analyst|initiates?|reiterates?)\b/i],
  ['Deal', /\b(acquire[sd]?|acquisition|merger|buyout|takeover|stake)\b/i],
  ['Legal & regulatory', /\b(lawsuit|sues?|sued|probe|investigation|antitrust|regulator[sy]?|sec\b|fine[sd]?|ban(ned)?|tariff)/i],
  ['Insider & filings', /\b(insider|10-k|10-q|8-k|filing|form 4)\b/i],
  ['Dividend & buyback', /\b(dividend|buyback|repurchase|split)\b/i],
  ['Product', /\b(launch(es|ed)?|unveil(s|ed)?|announce[sd]? new|partnership|contract)\b/i],
]

/** Event type from headline keywords. A plain keyword match, not a judgement of importance. */
export function tagHeadline(headline: string): string {
  return TAGS.find(([, re]) => re.test(headline))?.[0] ?? 'General'
}
