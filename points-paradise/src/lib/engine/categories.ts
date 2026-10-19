import type { CategorySlug } from '../domain/constants'
import type { Deal } from '../domain/types'
import { LONG_HAUL_MINUTES } from './geo'
import type { Valuation } from './valuation'

export interface CategoryContext {
  now: Date
  pointsBalance: number
  maxCashUsd: number
}

const LUXURY_NIGHTLY_USD = 500
const LAST_MINUTE_DAYS = 21

function weekdayUtc(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay()
}

export function daysUntil(date: string | null, now: Date): number | null {
  if (!date) return null
  const t = Date.parse(`${date}T00:00:00Z`)
  if (Number.isNaN(t)) return null
  return Math.floor((t - now.getTime()) / 86_400_000)
}

/** Categories a deal belongs to right now. Budget and timing categories depend on context. */
export function dealCategories(deal: Deal, valuation: Valuation, ctx: CategoryContext): CategorySlug[] {
  const out = new Set<CategorySlug>()
  const tags = new Set(deal.tags)
  if (deal.flight?.cabin === 'business') out.add('business')
  if (deal.flight?.cabin === 'first') out.add('first')
  if (deal.kind === 'hotel' || deal.kind === 'package') {
    const nightly = deal.comparableCashUsd != null && deal.nights ? deal.comparableCashUsd / deal.nights : null
    if (tags.has('luxury') || (nightly != null && nightly >= LUXURY_NIGHTLY_USD)) out.add('luxury-hotels')
    const rt = deal.hotel?.roomType
    if (tags.has('beach') || tags.has('island') || tags.has('overwater') || rt === 'villa' || rt === 'pool_villa' || rt === 'overwater_villa') {
      out.add('resorts')
    }
  }
  if (deal.kind === 'package') out.add('vacations')
  if (valuation.transfer && valuation.transfer.bonusPercent > 0) out.add('transfer-bonuses')
  if (deal.travelStart && deal.nights != null && deal.nights <= 3) {
    const wd = weekdayUtc(deal.travelStart)
    if (wd === 4 || wd === 5 || wd === 6) out.add('weekend')
  }
  if (deal.flight?.durationMinutes != null && deal.flight.durationMinutes >= LONG_HAUL_MINUTES) out.add('long-haul')
  const until = daysUntil(deal.travelStart, ctx.now)
  if (until != null && until >= 0 && until <= LAST_MINUTE_DAYS) out.add('last-minute')
  if (tags.has('hidden_gem')) out.add('sweet-spots')
  const pts = valuation.chasePoints
  if (pts != null) {
    if (pts < 50_000) out.add('under-50k')
    if (pts < 100_000) out.add('under-100k')
    if (pts <= ctx.pointsBalance && (deal.mandatoryCashUsd ?? Infinity) <= ctx.maxCashUsd) out.add('within-budget')
  }
  return [...out]
}
