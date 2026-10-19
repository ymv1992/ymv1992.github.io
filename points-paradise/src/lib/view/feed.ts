import type { FeedMode } from '../domain/constants'
import type { EvaluatedDeal } from '../engine/evaluate'
import { evidenceTier, rankDeals } from '../engine/ranking'

const EXCEPTIONAL_CPP = 4
const NEW_DAYS = 7
const ENDING_SOON_DAYS = 7
const FOR_YOU_MIN_MATCH = 45

function feedable(e: EvaluatedDeal): boolean {
  return evidenceTier(e.status) != null
}

function value(e: EvaluatedDeal): number {
  return e.valuation.practicalCpp ?? e.valuation.headlineCpp ?? -1
}

/**
 * Deals for a Discover mode. Points efficiency stays the primary order; the
 * personal match only filters "For You". Saved and passed deals are left out
 * of the swipe deck (passed deals remain recoverable in History).
 */
export function buildFeed(items: readonly EvaluatedDeal[], mode: FeedMode, opts: { now: Date; exclude: ReadonlySet<string> }): EvaluatedDeal[] {
  const base = items.filter((e) => feedable(e) && !opts.exclude.has(e.deal.id))
  let list: EvaluatedDeal[]
  switch (mode) {
    case 'for-you':
      list = base.filter((e) => !e.match.excluded && e.match.score >= FOR_YOU_MIN_MATCH)
      break
    case 'exceptional':
      list = base.filter((e) => value(e) >= EXCEPTIONAL_CPP)
      break
    case 'luxury-hotels':
      list = base.filter((e) => e.categories.includes('luxury-hotels') || e.categories.includes('resorts'))
      break
    case 'premium-cabins':
      list = base.filter((e) => e.categories.includes('business') || e.categories.includes('first'))
      break
    case 'hidden-gems':
      list = base.filter((e) => e.categories.includes('sweet-spots'))
      break
    case 'weekend':
      list = base.filter((e) => e.categories.includes('weekend'))
      break
    case 'last-minute':
      list = base.filter((e) => e.categories.includes('last-minute'))
      break
    case 'ending-soon':
      list = base.filter(
        (e) =>
          (e.deadline.countdownMs != null && e.deadline.countdownMs > 0 && e.deadline.countdownMs <= ENDING_SOON_DAYS * 86_400_000) ||
          e.deadline.type === 'estimated',
      )
      return list.sort((a, b) => (a.deadline.countdownMs ?? Infinity) - (b.deadline.countdownMs ?? Infinity))
    case 'new':
      list = base.filter((e) => opts.now.getTime() - e.deal.firstSeenAt.getTime() <= NEW_DAYS * 86_400_000)
      return list.sort((a, b) => b.deal.firstSeenAt.getTime() - a.deal.firstSeenAt.getTime())
    default:
      list = base
  }
  return list.sort((a, b) => (evidenceTier(a.status) ?? 9) - (evidenceTier(b.status) ?? 9) || value(b) - value(a))
}

/** Overall Top-100 rank for each deal id (verified tiers first). */
export function overallRanks(items: readonly EvaluatedDeal[], includeDemo: boolean, now: Date): Map<string, number> {
  const ranked = rankDeals(items, { includeDemo }, { now, limit: 100 })
  return new Map(ranked.map((r) => [r.item.deal.id, r.rank]))
}
