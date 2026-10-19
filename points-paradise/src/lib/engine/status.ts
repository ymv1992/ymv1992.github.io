import { FRESHNESS, type EvidenceStatus } from '../domain/constants'
import type { Deal } from '../domain/types'

export interface FreshnessThresholds {
  liveHours: number
  recentHours: number
}

function endOfDayUtc(date: string): number {
  return Date.parse(`${date}T23:59:59Z`)
}

export type ExpiryReason = 'deadline_passed' | 'travel_date_passed' | null

/** Why a deal is expired, or null if it is not. Uses the last travel date when dates are flexible. */
export function expiryReason(deal: Pick<Deal, 'deadline' | 'travelStart' | 'travelEnd' | 'flexibleDates'>, now: Date): ExpiryReason {
  if (deal.deadline.type === 'confirmed' && deal.deadline.at && deal.deadline.at.getTime() < now.getTime()) return 'deadline_passed'
  const lastDate = deal.flexibleDates ? (deal.travelEnd ?? deal.travelStart) : deal.travelStart
  if (lastDate) {
    const t = endOfDayUtc(lastDate)
    // Allow one extra day for time zones ahead of UTC.
    if (!Number.isNaN(t) && t + 86_400_000 < now.getTime()) return 'travel_date_passed'
  }
  return null
}

export function isExpired(deal: Pick<Deal, 'deadline' | 'travelStart' | 'travelEnd' | 'flexibleDates'>, now: Date): boolean {
  return expiryReason(deal, now) !== null
}

/**
 * Evidence status. The order of checks matters: demo data is always labelled demo,
 * expired beats everything else, and only a recent verification counts as "verified".
 */
export function computeStatus(
  deal: Pick<Deal, 'sourceKind' | 'deadline' | 'travelStart' | 'travelEnd' | 'flexibleDates' | 'availability' | 'lastVerifiedAt'>,
  now: Date,
  t: FreshnessThresholds = FRESHNESS,
): EvidenceStatus {
  if (deal.sourceKind === 'demo') return 'demo'
  if (isExpired(deal, now)) return 'expired'
  if (deal.availability === 'unavailable') return 'unavailable'
  if (deal.sourceKind === 'prediction') return 'prediction'
  if (!deal.lastVerifiedAt || deal.sourceKind === 'research' || deal.sourceKind === 'announcement') return 'unverified_lead'
  const ageHours = (now.getTime() - deal.lastVerifiedAt.getTime()) / 3_600_000
  if (ageHours <= t.liveHours) return 'verified_live'
  if (ageHours <= t.recentHours) return 'recently_verified'
  return 'cached'
}

/** Whether the status may be presented as currently bookable. */
export function isBookableStatus(s: EvidenceStatus): boolean {
  return s === 'verified_live' || s === 'recently_verified'
}

/** Stale when older than twice the refresh interval, or older than the recent threshold. */
export function isStale(lastVerifiedAt: Date | null, now: Date, refreshHours: number, t: FreshnessThresholds = FRESHNESS): boolean {
  if (!lastVerifiedAt) return true
  const ageHours = (now.getTime() - lastVerifiedAt.getTime()) / 3_600_000
  return ageHours > Math.min(refreshHours * 2, t.recentHours)
}

export function formatAge(from: Date | null, now: Date): string {
  if (!from) return 'never'
  const mins = Math.max(0, Math.round((now.getTime() - from.getTime()) / 60_000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 60) return `${days} days ago`
  return `${Math.round(days / 30)} months ago`
}
