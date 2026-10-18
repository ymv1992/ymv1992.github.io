import type { Availability } from '../domain/constants'
import { median } from './valuation'

export interface Observation {
  observedAt: Date
  programPoints: number | null
  cashUsd: number | null
  mandatoryCashUsd: number | null
  availability: Availability
}

export interface PriceChange {
  kind: 'drop' | 'rise' | 'none'
  pointsDelta: number | null
  pointsPct: number | null
  cashDelta: number | null
  availabilityChange: 'appeared' | 'disappeared' | null
  significant: boolean
}

/** Compares two observations. A drop of ≥5% in points, or newly appearing space, is significant. */
export function detectPriceChange(prev: Observation | null, curr: Observation, minPct = 5): PriceChange {
  const availabilityChange =
    prev && prev.availability !== 'available' && curr.availability === 'available'
      ? 'appeared'
      : prev && prev.availability === 'available' && curr.availability === 'unavailable'
        ? 'disappeared'
        : null
  if (!prev || prev.programPoints == null || curr.programPoints == null) {
    return { kind: 'none', pointsDelta: null, pointsPct: null, cashDelta: null, availabilityChange, significant: availabilityChange === 'appeared' }
  }
  const delta = curr.programPoints - prev.programPoints
  const pct = prev.programPoints > 0 ? (delta / prev.programPoints) * 100 : 0
  const cashDelta = prev.mandatoryCashUsd != null && curr.mandatoryCashUsd != null ? curr.mandatoryCashUsd - prev.mandatoryCashUsd : null
  const kind = delta < 0 ? 'drop' : delta > 0 ? 'rise' : 'none'
  return {
    kind,
    pointsDelta: delta,
    pointsPct: Math.round(pct * 10) / 10,
    cashDelta,
    availabilityChange,
    significant: (kind === 'drop' && -pct >= minPct) || availabilityChange === 'appeared',
  }
}

export interface HistoryStats {
  count: number
  spanDays: number
  minPoints: number | null
  medianPoints: number | null
  p25Points: number | null
  availabilityRate: number | null
  /** Median length (days) of continuous runs of observed availability. */
  medianAvailableRunDays: number | null
}

function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))))
  return sorted[idx]!
}

export function historyStats(obs: readonly Observation[]): HistoryStats {
  const sorted = [...obs].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime())
  const pts = sorted.filter((o) => o.availability === 'available' && o.programPoints != null).map((o) => o.programPoints!)
  const ptsSorted = [...pts].sort((a, b) => a - b)
  const known = sorted.filter((o) => o.availability !== 'unknown')
  const runs: number[] = []
  let runStart: Date | null = null
  let last: Date | null = null
  for (const o of known) {
    if (o.availability === 'available') {
      if (!runStart) runStart = o.observedAt
      last = o.observedAt
    } else if (runStart && last) {
      runs.push((o.observedAt.getTime() - runStart.getTime()) / 86_400_000)
      runStart = null
    }
  }
  const span = sorted.length > 1 ? (sorted[sorted.length - 1]!.observedAt.getTime() - sorted[0]!.observedAt.getTime()) / 86_400_000 : 0
  return {
    count: sorted.length,
    spanDays: Math.round(span * 10) / 10,
    minPoints: ptsSorted[0] ?? null,
    medianPoints: median(ptsSorted),
    p25Points: percentile(ptsSorted, 25),
    availabilityRate: known.length ? known.filter((o) => o.availability === 'available').length / known.length : null,
    medianAvailableRunDays: runs.length ? median(runs) : null,
  }
}

export const MIN_OBSERVATIONS_FOR_PREDICTION = 10
export const MIN_SPAN_DAYS_FOR_PREDICTION = 30

export type Prediction =
  | { reliable: false; reason: string; stats: HistoryStats }
  | {
      reliable: true
      confidence: 'low' | 'medium' | 'high'
      percentile: number
      urgency: 'high' | 'medium' | 'low'
      explanation: string
      stats: HistoryStats
    }

/**
 * Evidence-based outlook for a route or property. Never produces a "book now"
 * signal without enough history; the result is always labelled a prediction.
 */
export function predict(obs: readonly Observation[], currentPoints: number | null): Prediction {
  const stats = historyStats(obs)
  if (stats.count < MIN_OBSERVATIONS_FOR_PREDICTION || stats.spanDays < MIN_SPAN_DAYS_FOR_PREDICTION) {
    return {
      reliable: false,
      reason: `No reliable prediction available: ${stats.count} observation${stats.count === 1 ? '' : 's'} over ${stats.spanDays} days (need at least ${MIN_OBSERVATIONS_FOR_PREDICTION} over ${MIN_SPAN_DAYS_FOR_PREDICTION} days).`,
      stats,
    }
  }
  const pts = obs.filter((o) => o.availability === 'available' && o.programPoints != null).map((o) => o.programPoints!)
  if (currentPoints == null || pts.length < 3) {
    return { reliable: false, reason: 'Not enough priced observations to compare the current price.', stats }
  }
  const below = pts.filter((p) => p < currentPoints).length
  const higher = pts.filter((p) => p > currentPoints).length
  const pctile = Math.round((below / pts.length) * 100)
  const cheaperThanPct = Math.round((higher / pts.length) * 100)
  const rate = stats.availabilityRate ?? 1
  const shortRuns = stats.medianAvailableRunDays != null && stats.medianAvailableRunDays <= 3
  const urgency: 'high' | 'medium' | 'low' = pctile <= 15 && (rate < 0.3 || shortRuns) ? 'high' : pctile <= 35 ? 'medium' : 'low'
  const confidence: 'low' | 'medium' | 'high' = stats.count >= 60 && stats.spanDays >= 180 ? 'high' : stats.count >= 25 ? 'medium' : 'low'
  const runText =
    stats.medianAvailableRunDays != null ? ` Availability at this level has typically lasted about ${Math.round(stats.medianAvailableRunDays * 10) / 10} days.` : ''
  return {
    reliable: true,
    confidence,
    percentile: pctile,
    urgency,
    explanation: `Current price is lower than ${cheaperThanPct}% of ${pts.length} priced observations over ${Math.round(stats.spanDays)} days; space was seen ${Math.round(rate * 100)}% of the time.${runText} This is a statistical pattern, not a guarantee.`,
    stats,
  }
}
