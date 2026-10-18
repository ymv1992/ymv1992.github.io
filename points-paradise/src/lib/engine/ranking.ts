import { CABIN_LABELS, type Cabin, type CategorySlug, type EvidenceStatus, type Region } from '../domain/constants'
import type { EvaluatedDeal } from './evaluate'
import { isBookableStatus } from './status'

export const SORT_OPTIONS = [
  { id: 'efficiency', label: 'Highest points efficiency' },
  { id: 'lowest_points', label: 'Lowest points cost' },
  { id: 'lowest_cash', label: 'Lowest cash cost' },
  { id: 'highest_savings', label: 'Highest cash savings' },
  { id: 'soonest_deadline', label: 'Soonest booking deadline' },
  { id: 'recently_verified', label: 'Most recently verified' },
  { id: 'price_improvement', label: 'Greatest price improvement' },
  { id: 'personal_match', label: 'Best personal match' },
] as const
export type SortOption = (typeof SORT_OPTIONS)[number]['id']

/** Evidence tier: lower is stronger. Null means never ranked. */
export function evidenceTier(status: EvidenceStatus): number | null {
  switch (status) {
    case 'verified_live':
    case 'recently_verified':
      return 0
    case 'cached':
      return 1
    case 'unverified_lead':
      return 2
    case 'demo':
      return 3
    default:
      return null
  }
}

export const TIER_LABELS: Record<number, string> = {
  0: 'Verified — bookable at last check',
  1: 'Cached — needs re-verification',
  2: 'Unverified leads',
  3: 'Demo data (fictional)',
}

export interface RankFilters {
  query?: string
  destination?: string
  region?: Region | null
  departureAirport?: string | null
  maxPoints?: number | null
  maxCash?: number | null
  minNights?: number | null
  maxNights?: number | null
  travelFrom?: string | null
  travelTo?: string | null
  cabin?: Cabin | null
  hotelCategory?: string | null
  nonstopOnly?: boolean
  positioningRequired?: 'any' | 'yes' | 'no'
  homeAirports?: readonly string[]
  statuses?: readonly EvidenceStatus[] | null
  deadlineWithinDays?: number | null
  minCpp?: number | null
  saved?: 'any' | 'saved' | 'unsaved'
  savedIds?: ReadonlySet<string>
  category?: CategorySlug | null
  includeDemo?: boolean
  excludeIds?: ReadonlySet<string>
}

export interface RankedDeal {
  item: EvaluatedDeal
  rank: number
  tier: number
  score: number | null
  explanation: string[]
}

export interface RankOptions {
  sort?: SortOption
  /** Minimum valuation confidence to appear in the ranked list. */
  minConfidence?: 'low' | 'medium' | 'high'
  limit?: number
  now: Date
  priceImprovement?: ReadonlyMap<string, number>
}

const CONFIDENCE_ORDER = { low: 0, medium: 1, high: 2 } as const

function matchesFilters(e: EvaluatedDeal, f: RankFilters): boolean {
  const d = e.deal
  if (f.excludeIds?.has(d.id)) return false
  if (!f.includeDemo && d.sourceKind === 'demo') return false
  if (f.statuses && f.statuses.length > 0 && !f.statuses.includes(e.status)) return false
  if (f.category && !e.categories.includes(f.category)) return false
  if (f.query) {
    const q = f.query.toLowerCase()
    const hay = [d.title, d.destination.city, d.destination.country, d.providerName, d.hotel?.property ?? '', d.destination.airport ?? '', d.originAirport ?? '']
      .join(' ')
      .toLowerCase()
    if (!hay.includes(q)) return false
  }
  if (f.destination) {
    const q = f.destination.toLowerCase()
    if (![d.destination.city, d.destination.country, d.destination.airport ?? ''].some((s) => s.toLowerCase().includes(q))) return false
  }
  if (f.region && d.destination.region !== f.region) return false
  if (f.departureAirport && d.originAirport !== f.departureAirport.toUpperCase()) return false
  const pts = e.valuation.chasePoints
  if (f.maxPoints != null && (pts == null || pts > f.maxPoints)) return false
  if (f.maxCash != null && (d.mandatoryCashUsd == null || d.mandatoryCashUsd > f.maxCash)) return false
  if (f.minNights != null && (d.nights == null || d.nights < f.minNights)) return false
  if (f.maxNights != null && (d.nights == null || d.nights > f.maxNights)) return false
  if (f.travelFrom && (!d.travelStart || (d.travelEnd ?? d.travelStart) < f.travelFrom)) return false
  if (f.travelTo && (!d.travelStart || d.travelStart > f.travelTo)) return false
  if (f.cabin && d.flight?.cabin !== f.cabin) return false
  if (f.hotelCategory && !(d.hotel?.programCategory ?? '').toLowerCase().includes(f.hotelCategory.toLowerCase())) return false
  if (f.nonstopOnly && d.flight && (d.flight.stops ?? 0) > 0) return false
  if (f.positioningRequired && f.positioningRequired !== 'any' && d.kind === 'flight' && f.homeAirports) {
    const fromHome = d.originAirport != null && f.homeAirports.includes(d.originAirport)
    if (f.positioningRequired === 'yes' && fromHome) return false
    if (f.positioningRequired === 'no' && !fromHome) return false
  }
  if (f.deadlineWithinDays != null) {
    const ms = e.deadline.countdownMs
    if (ms == null || ms < 0 || ms > f.deadlineWithinDays * 86_400_000) return false
  }
  const cpp = e.valuation.practicalCpp ?? e.valuation.headlineCpp
  if (f.minCpp != null && (cpp == null || cpp < f.minCpp)) return false
  if (f.saved === 'saved' && !f.savedIds?.has(d.id)) return false
  if (f.saved === 'unsaved' && f.savedIds?.has(d.id)) return false
  return true
}

function sortValue(e: EvaluatedDeal, sort: SortOption, priceImprovement?: ReadonlyMap<string, number>): number | null {
  const v = e.valuation
  switch (sort) {
    case 'efficiency':
      return v.practicalCpp ?? v.headlineCpp
    case 'lowest_points':
      return v.chasePoints != null ? -v.chasePoints : null
    case 'lowest_cash':
      return e.deal.mandatoryCashUsd != null ? -e.deal.mandatoryCashUsd : null
    case 'highest_savings':
      return v.cashSavingsUsd
    case 'soonest_deadline':
      return e.deadline.countdownMs != null && e.deadline.countdownMs > 0 ? -e.deadline.countdownMs : null
    case 'recently_verified':
      return e.deal.lastVerifiedAt ? e.deal.lastVerifiedAt.getTime() : null
    case 'price_improvement':
      return priceImprovement?.get(e.deal.id) ?? null
    case 'personal_match':
      return e.match.score
  }
}

export function explainRanking(e: EvaluatedDeal, rank: number, tier: number): string[] {
  const v = e.valuation
  const out: string[] = []
  if (v.headlineCpp != null) {
    const p = v.practicalCpp ?? v.headlineCpp
    out.push(
      Math.abs(p - v.headlineCpp) < 0.005
        ? `${p.toFixed(2)}¢ per Chase point`
        : `${p.toFixed(2)}¢ practical value (${v.headlineCpp.toFixed(2)}¢ headline)`,
    )
  }
  if (v.chasePoints != null && e.deal.comparableCashUsd != null) {
    out.push(
      `${v.chasePoints.toLocaleString('en-US')} Chase points + $${(e.deal.mandatoryCashUsd ?? 0).toLocaleString('en-US')} instead of $${e.deal.comparableCashUsd.toLocaleString('en-US')} cash`,
    )
  }
  if (e.deal.flight) out.push(`${CABIN_LABELS[e.deal.flight.cabin]} on ${e.deal.providerName}`)
  if (v.transfer?.bonusPercent) {
    out.push(
      v.transfer.bonusSource === 'illustrative'
        ? `Illustrative ${v.transfer.bonusPercent}% bonus (demo only)`
        : `${v.transfer.bonusPercent}% transfer bonus applied`,
    )
  }
  out.push(`#${rank} in tier: ${TIER_LABELS[tier]}`)
  out.push(`Valuation confidence: ${v.confidence}`)
  if (!isBookableStatus(e.status)) out.push('Not confirmed bookable — verify before transferring points')
  return out
}

/**
 * Ranks deals by points efficiency within evidence tiers so unverified or
 * stale opportunities never outrank verified ones. Expired, unavailable,
 * prediction-only and non-calculable deals are excluded from rankings.
 */
export function rankDeals(items: readonly EvaluatedDeal[], filters: RankFilters, opts: RankOptions): RankedDeal[] {
  const sort = opts.sort ?? 'efficiency'
  const minConf = CONFIDENCE_ORDER[opts.minConfidence ?? 'medium']
  const eligible: { item: EvaluatedDeal; tier: number; score: number | null }[] = []
  for (const item of items) {
    const tier = evidenceTier(item.status)
    if (tier == null) continue
    if (!item.valuation.calculable) continue
    if (CONFIDENCE_ORDER[item.valuation.confidence] < minConf) continue
    if (!matchesFilters(item, filters)) continue
    eligible.push({ item, tier, score: sortValue(item, sort, opts.priceImprovement) })
  }
  eligible.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier
    if (a.score == null && b.score != null) return 1
    if (b.score == null && a.score != null) return -1
    if (a.score != null && b.score != null && a.score !== b.score) return b.score - a.score
    // Tie-breakers: efficiency, then freshest verification, then id for stability.
    const ae = a.item.valuation.practicalCpp ?? 0
    const be = b.item.valuation.practicalCpp ?? 0
    if (ae !== be) return be - ae
    const av = a.item.deal.lastVerifiedAt?.getTime() ?? 0
    const bv = b.item.deal.lastVerifiedAt?.getTime() ?? 0
    if (av !== bv) return bv - av
    return a.item.deal.id.localeCompare(b.item.deal.id)
  })
  const limited = opts.limit ? eligible.slice(0, opts.limit) : eligible
  const tierCounters = new Map<number, number>()
  return limited.map(({ item, tier, score }, i) => {
    const inTier = (tierCounters.get(tier) ?? 0) + 1
    tierCounters.set(tier, inTier)
    return { item, rank: i + 1, tier, score, explanation: explainRanking(item, inTier, tier) }
  })
}

/** Deals that cannot be ranked yet, with the reason, for a "needs information" list. */
export function unrankable(items: readonly EvaluatedDeal[], includeDemo: boolean): { item: EvaluatedDeal; reason: string }[] {
  const out: { item: EvaluatedDeal; reason: string }[] = []
  for (const item of items) {
    if (!includeDemo && item.deal.sourceKind === 'demo') continue
    const tier = evidenceTier(item.status)
    if (tier == null) continue
    if (!item.valuation.calculable) out.push({ item, reason: item.valuation.reasons[0] ?? 'Value cannot be reliably calculated' })
    else if (item.valuation.confidence === 'low') out.push({ item, reason: 'Low confidence in the cash comparison' })
  }
  return out
}
