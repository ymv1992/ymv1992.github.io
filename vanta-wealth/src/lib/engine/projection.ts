/**
 * Wealth projection maths. Everything here is a model built on the owner's
 * assumptions (average return, volatility, fees, inflation). Nothing here is
 * a forecast of what markets will do.
 */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function gaussian(rand: () => number): number {
  let u = 0
  while (u === 0) u = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}

export interface ScenarioEvents {
  /** From this year on (1-based), the monthly contribution becomes `monthly`. */
  contributionChange?: { fromYear: number; monthly: number }
  /** Contributions pause for the given years (e.g. a career break). */
  pause?: { fromYear: number; years: number }
  /** A one-time market drop applied at the start of the year, on top of normal variation. */
  crash?: { year: number; dropPct: number }
  /** A one-time withdrawal at the start of the year (e.g. a property down payment). */
  withdrawal?: { year: number; amount: number }
}

export interface SimInput {
  start: number
  monthly: number
  years: number
  meanReturnPct: number
  volatilityPct: number
  feePct: number
  runs?: number
  seed?: number
  events?: ScenarioEvents
}

export interface SimResult {
  /** Index 0 is today; index y is the end of year y. */
  p10: number[]
  p25: number[]
  p50: number[]
  p75: number[]
  p90: number[]
  /** Money put in (starting value plus contributions, minus withdrawals) by year. */
  contributed: number[]
  /** Sorted final values of every run. */
  finals: number[]
  /** Per year, the share of runs at or above each value can be read with `probabilityAtLeast`. */
  sortedByYear: number[][]
}

function contributionFor(month: number, base: number, ev?: ScenarioEvents): number {
  const year = Math.floor(month / 12) + 1
  if (ev?.pause && year >= ev.pause.fromYear && year < ev.pause.fromYear + ev.pause.years) return 0
  if (ev?.contributionChange && year >= ev.contributionChange.fromYear) return ev.contributionChange.monthly
  return base
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  const i = (sorted.length - 1) * p
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo)
}

/**
 * Monte Carlo: each run draws monthly returns from a lognormal distribution
 * whose yearly average is `meanReturnPct - feePct` and yearly standard
 * deviation is `volatilityPct`. Real markets have fatter tails and returns
 * that cluster, so treat the spread as a rough guide.
 */
export function simulate(input: SimInput): SimResult {
  const runs = input.runs ?? 5000
  const rand = mulberry32(input.seed ?? 20260101)
  const months = Math.round(input.years * 12)
  const net = (input.meanReturnPct - input.feePct) / 100
  const vol = input.volatilityPct / 100
  // Log-return drift that makes the expected yearly growth equal `net`.
  const mu = (Math.log(1 + Math.max(net, -0.99)) - (vol * vol) / 2) / 12
  const sigma = vol / Math.sqrt(12)
  const ev = input.events

  const byYear: number[][] = Array.from({ length: input.years + 1 }, () => new Array<number>(runs))
  for (let r = 0; r < runs; r++) {
    let v = input.start
    byYear[0]![r] = v
    for (let m = 0; m < months; m++) {
      if (m % 12 === 0) {
        const year = m / 12 + 1
        if (ev?.crash && ev.crash.year === year) v *= 1 - ev.crash.dropPct / 100
        if (ev?.withdrawal && ev.withdrawal.year === year) v = Math.max(0, v - ev.withdrawal.amount)
      }
      v = v * Math.exp(mu + sigma * gaussian(rand)) + contributionFor(m, input.monthly, ev)
      if ((m + 1) % 12 === 0) byYear[(m + 1) / 12]![r] = v
    }
  }
  const sortedByYear = byYear.map((a) => [...a].sort((x, y) => x - y))

  const contributed = [input.start]
  let c = input.start
  for (let m = 0; m < months; m++) {
    if (m % 12 === 0 && ev?.withdrawal && ev.withdrawal.year === m / 12 + 1) c -= ev.withdrawal.amount
    c += contributionFor(m, input.monthly, ev)
    if ((m + 1) % 12 === 0) contributed.push(c)
  }

  const pick = (p: number) => sortedByYear.map((s) => percentile(s, p))
  return { p10: pick(0.1), p25: pick(0.25), p50: pick(0.5), p75: pick(0.75), p90: pick(0.9), contributed, finals: sortedByYear[input.years]!, sortedByYear }
}

/** Share of runs (0–1) with a value at or above `target` at the end of `year`. */
export function probabilityAtLeast(result: SimResult, year: number, target: number): number {
  const sorted = result.sortedByYear[Math.min(Math.max(0, Math.round(year)), result.sortedByYear.length - 1)]!
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid]! < target) lo = mid + 1
    else hi = mid
  }
  return (sorted.length - lo) / sorted.length
}

/** First year in which the median run reaches `target`, or null within the horizon. */
export function medianYearToReach(result: SimResult, target: number): number | null {
  const i = result.p50.findIndex((v) => v >= target)
  return i < 0 ? null : i
}

/** Steady-growth value after `years` at a fixed yearly rate with monthly contributions. */
export function futureValue(start: number, monthly: number, annualPct: number, years: number): number {
  const r = Math.pow(1 + annualPct / 100, 1 / 12) - 1
  const n = Math.round(years * 12)
  if (Math.abs(r) < 1e-12) return start + monthly * n
  return start * Math.pow(1 + r, n) + monthly * ((Math.pow(1 + r, n) - 1) / r)
}

/** Months to reach `target` at a fixed yearly rate; null if not within 100 years. */
export function monthsToReach(start: number, monthly: number, annualPct: number, target: number): number | null {
  if (start >= target) return 0
  const r = Math.pow(1 + annualPct / 100, 1 / 12) - 1
  let v = start
  for (let m = 1; m <= 1200; m++) {
    v = v * (1 + r) + monthly
    if (v >= target) return m
  }
  return null
}

/** Converts a future amount into today's dollars. */
export function toRealDollars(value: number, inflationPct: number, years: number): number {
  return value / Math.pow(1 + inflationPct / 100, years)
}

/** What a yearly fee costs over time, at a fixed growth rate. */
export function feeDrag(start: number, monthly: number, annualPct: number, feePct: number, years: number): { withoutFee: number; withFee: number; cost: number } {
  const withoutFee = futureValue(start, monthly, annualPct, years)
  const withFee = futureValue(start, monthly, annualPct - feePct, years)
  return { withoutFee, withFee, cost: withoutFee - withFee }
}

/** Portfolio needed to fund yearly spending at a chosen withdrawal rate. */
export function freedomNumber(annualSpending: number, withdrawalRatePct: number): number {
  return withdrawalRatePct > 0 ? annualSpending / (withdrawalRatePct / 100) : Infinity
}
