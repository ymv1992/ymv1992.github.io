import { describe, expect, it } from 'vitest'
import { DEFAULT_PROFILE } from '@/lib/domain/types'
import { classifySymbol } from '@/lib/domain/reference'
import { diffImport, parseHoldings } from '@/lib/engine/import'
import { allocation, applyTrade, checkRules, healthScore, monthsUntilTopUnder, summarize, type HoldingInput } from '@/lib/engine/portfolio'
import { feeDrag, freedomNumber, futureValue, medianYearToReach, monthsToReach, probabilityAtLeast, simulate, toRealDollars } from '@/lib/engine/projection'
import { freshness } from '@/lib/format'

const h = (symbol: string, quantity: number, avgCost: number | null, extra: Partial<HoldingInput> = {}): HoldingInput => ({
  ...classifySymbol(symbol),
  id: symbol,
  symbol,
  name: symbol,
  quantity,
  avgCost,
  status: 'confirmed',
  ...extra,
})

describe('summarize', () => {
  const holdings = [h('AAA', 10, 50), h('VTI', 2, 100), h('BTC', 1, null), h('ZZZ', 5, 20)]
  const quotes = new Map([
    ['AAA', { price: 80, prevClose: 78 }],
    ['VTI', { price: 110, prevClose: 110 }],
  ])
  const s = summarize(holdings, quotes, [{ name: 'Retirement', value: 1000, bucket: 'us_index' }])

  it('values priced holdings at market and unpriced ones at cost, and never guesses', () => {
    const by = Object.fromEntries(s.positions.map((p) => [p.symbol, p]))
    expect(by.AAA!.value).toBe(800)
    expect(by.AAA!.gain).toBe(300)
    expect(by.AAA!.gainPct).toBeCloseTo(60)
    expect(by.ZZZ!.valueBasis).toBe('cost')
    expect(by.ZZZ!.value).toBe(100)
    expect(by.ZZZ!.gain).toBeNull()
    expect(by.BTC!.valueBasis).toBe('none')
    expect(by.BTC!.value).toBeNull()
    expect([s.pricedCount, s.atCostCount, s.unvaluedCount]).toEqual([2, 1, 1])
  })

  it('totals', () => {
    expect(s.holdingsValue).toBe(800 + 220 + 100)
    expect(s.portfolioValue).toBe(2120)
    expect(s.costBasis).toBe(500 + 200 + 100)
    expect(s.unrealizedGain).toBe(320)
    expect(s.dayChange).toBe(20)
    expect(s.byBucket.us_index).toBe(1220)
    expect(s.positions.find((p) => p.symbol === 'AAA')!.weight).toBeCloseTo((800 / 2120) * 100)
  })

  it('allocation gaps sum to zero when targets sum to 100', () => {
    const rows = allocation(s, DEFAULT_PROFILE.targets)
    expect(rows.reduce((a, r) => a + r.gapValue, 0)).toBeCloseTo(0)
    expect(rows.find((r) => r.bucket === 'us_index')!.pct).toBeCloseTo((1220 / 2120) * 100)
  })

  it('flags broken rules and exempts funds from the single-position limit', () => {
    const rules = checkRules(s, DEFAULT_PROFILE.rules)
    const by = Object.fromEntries(rules.map((r) => [r.id, r]))
    expect(by.single!.broken).toBe(true)
    expect(by.single!.measured).toContain('AAA')
    expect(by.single!.measured).not.toContain('VTI')
    expect(by.index!.broken).toBe(false)
    expect(by.speculative!.broken).toBe(false)
    const score = healthScore(s, allocation(s, DEFAULT_PROFILE.targets), rules, 1)
    expect(score.total).toBeGreaterThan(0)
    expect(score.total).toBeLessThanOrEqual(100)
    expect(score.parts.reduce((a, p) => a + p.max, 0)).toBe(100)
  })

  it('handles an empty portfolio', () => {
    const e = summarize([], new Map())
    expect(e.portfolioValue).toBe(0)
    expect(checkRules(e, DEFAULT_PROFILE.rules).every((r) => !r.broken)).toBe(true)
  })
})

describe('monthsUntilTopUnder', () => {
  it('counts months of new money needed to dilute the top positions', () => {
    // 6000 of 10000 = 60%. To be 40% the total must reach 15000: 10 months at 500.
    expect(monthsUntilTopUnder(6000, 10000, 40, 500)).toBe(10)
    expect(monthsUntilTopUnder(3000, 10000, 40, 500)).toBe(0)
    expect(monthsUntilTopUnder(6000, 10000, 40, 0)).toBeNull()
    // Trimming 2000 leaves 4000 of 10000 = 40% exactly.
    expect(monthsUntilTopUnder(6000, 10000, 40, 500, 2000)).toBe(0)
  })
})

describe('applyTrade', () => {
  it('uses average cost', () => {
    const a = applyTrade({ quantity: 10, avgCost: 100 }, { type: 'buy', quantity: 10, price: 200, fees: 0 })
    expect(a).toEqual({ quantity: 20, avgCost: 150, realizedGain: null })
    const b = applyTrade(a, { type: 'sell', quantity: 5, price: 170, fees: 1 })
    expect(b.quantity).toBe(15)
    expect(b.avgCost).toBe(150)
    expect(b.realizedGain).toBe(99)
    expect(() => applyTrade(a, { type: 'sell', quantity: 21, price: 1, fees: 0 })).toThrow()
    expect(applyTrade(null, { type: 'buy', quantity: 2, price: 10, fees: 1 }).avgCost).toBe(10.5)
    expect(applyTrade({ quantity: 1, avgCost: null }, { type: 'sell', quantity: 1, price: 10, fees: 0 }).realizedGain).toBeNull()
  })
})

describe('parseHoldings', () => {
  it('reads a quick list with mixed separators and unknown costs', () => {
    const r = parseHoldings('AAA 12 / $34.50 · BBB 0.0125 / $210.75 · CCC 3 / ?\nBitcoin 1\nXRP 500')
    expect(r.errors).toEqual([])
    expect(r.rows.map((x) => [x.symbol, x.quantity, x.avgCost])).toEqual([
      ['AAA', 12, 34.5],
      ['BBB', 0.0125, 210.75],
      ['CCC', 3, null],
      ['BTC', 1, null],
      ['XRP', 500, null],
    ])
  })

  it('reads a CSV with headers, quotes and thousands separators', () => {
    const r = parseHoldings('Ticker,Name,Shares,Avg Cost,Account\nAAA,"Acme, Inc.","1,250",$12.50,Main\nBBB,Beta,abc,1,Main')
    expect(r.rows).toEqual([{ symbol: 'AAA', quantity: 1250, avgCost: 12.5, name: 'Acme, Inc.', account: 'Main', purchaseDate: null }])
    expect(r.errors).toHaveLength(1)
  })

  it('merges duplicates and reports unreadable lines', () => {
    const r = parseHoldings('AAA 10 / $10\nAAA 10 / $20\n???')
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toMatchObject({ quantity: 20, avgCost: 15 })
    expect(r.errors).toHaveLength(1)
  })

  it('diffs against existing records', () => {
    const { rows } = parseHoldings('AAA 10 / $10\nBBB 5 / $1\nCCC 1 / $1')
    const d = diffImport(rows, [
      { symbol: 'AAA', account: '', quantity: 10, avgCost: 10, status: 'confirmed' },
      { symbol: 'BBB', account: '', quantity: 4, avgCost: 1, status: 'confirmed' },
    ])
    expect(d.map((x) => x.change)).toEqual(['same', 'changed', 'new'])
  })
})

describe('projection', () => {
  it('future value and months to reach agree', () => {
    expect(futureValue(1000, 0, 10, 1)).toBeCloseTo(1100)
    expect(futureValue(0, 100, 0, 2)).toBe(2400)
    const m = monthsToReach(10000, 500, 7, 100000)!
    expect(futureValue(10000, 500, 7, m / 12)).toBeGreaterThanOrEqual(100000)
    expect(futureValue(10000, 500, 7, (m - 1) / 12)).toBeLessThan(100000)
    expect(monthsToReach(10, 0, 0, 100)).toBeNull()
  })

  it('fee drag, inflation and freedom number', () => {
    const d = feeDrag(100000, 500, 7, 1, 20)
    expect(d.cost).toBeGreaterThan(0)
    expect(d.withFee).toBeCloseTo(futureValue(100000, 500, 6, 20))
    expect(toRealDollars(1000, 0, 10)).toBe(1000)
    expect(toRealDollars(1000, 2.5, 10)).toBeCloseTo(781.2, 1)
    expect(freedomNumber(40000, 4)).toBe(1_000_000)
  })

  it('Monte Carlo is reproducible, ordered, and centred on the assumed return', () => {
    const input = { start: 100000, monthly: 0, years: 10, meanReturnPct: 7, volatilityPct: 16, feePct: 0, runs: 4000, seed: 7 }
    const a = simulate(input)
    expect(simulate(input).p50).toEqual(a.p50)
    for (let y = 1; y <= 10; y++) {
      expect(a.p10[y]!).toBeLessThan(a.p25[y]!)
      expect(a.p25[y]!).toBeLessThan(a.p50[y]!)
      expect(a.p50[y]!).toBeLessThan(a.p75[y]!)
      expect(a.p75[y]!).toBeLessThan(a.p90[y]!)
    }
    const mean = a.finals.reduce((s, v) => s + v, 0) / a.finals.length
    expect(mean / (100000 * 1.07 ** 10)).toBeGreaterThan(0.95)
    expect(mean / (100000 * 1.07 ** 10)).toBeLessThan(1.05)
    // Volatility pulls the median below the average.
    expect(a.p50[10]!).toBeLessThan(mean)
    expect(probabilityAtLeast(a, 10, 0)).toBe(1)
    expect(probabilityAtLeast(a, 10, a.p50[10]!)).toBeCloseTo(0.5, 1)
    expect(probabilityAtLeast(a, 10, 1e12)).toBe(0)
  })

  it('zero volatility matches steady growth, and events apply', () => {
    const base = { start: 50000, monthly: 500, years: 5, meanReturnPct: 6, volatilityPct: 0, feePct: 0, runs: 10 }
    const a = simulate(base)
    expect(a.p50[5]!).toBeCloseTo(futureValue(50000, 500, 6, 5), 0)
    expect(a.contributed[5]).toBe(50000 + 500 * 60)
    const crash = simulate({ ...base, events: { crash: { year: 1, dropPct: 30 } } })
    expect(crash.p50[1]!).toBeLessThan(a.p50[1]!)
    const pause = simulate({ ...base, events: { pause: { fromYear: 2, years: 2 } } })
    expect(pause.contributed[5]).toBe(50000 + 500 * 36)
    const more = simulate({ ...base, events: { contributionChange: { fromYear: 3, monthly: 1000 } } })
    expect(more.contributed[5]).toBe(50000 + 500 * 24 + 1000 * 36)
    const buy = simulate({ ...base, events: { withdrawal: { year: 2, amount: 20000 } } })
    expect(buy.contributed[5]).toBe(50000 + 500 * 60 - 20000)
    expect(medianYearToReach(a, 60000)).toBe(2)
    expect(medianYearToReach(a, 1e9)).toBeNull()
  })
})

describe('freshness', () => {
  const now = new Date('2026-11-16T15:00:00Z')
  it('labels by the provider timestamp', () => {
    expect(freshness(new Date('2026-11-16T14:50:00Z'), now, now).level).toBe('recent')
    expect(freshness(new Date('2026-11-13T21:00:00Z'), now, now).level).toBe('last')
    expect(freshness(new Date('2026-11-01T21:00:00Z'), now, now).level).toBe('stale')
    expect(freshness(null, null, now).level).toBe('none')
  })
})
