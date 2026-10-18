import { EVIDENCE_LABELS, type CategorySlug, type EvidenceStatus } from '../domain/constants'
import type { Deal } from '../domain/types'
import { dealCategories, type CategoryContext } from './categories'
import { describeDeadline, type DeadlineView } from './deadlines'
import { personalMatch, type PersonalMatch, type ProfilePreferences } from './personalization'
import { computeStatus, expiryReason, type ExpiryReason } from './status'
import { valueDeal, type Valuation, type ValuationContext } from './valuation'

export interface EvaluatedDeal {
  deal: Deal
  valuation: Valuation
  status: EvidenceStatus
  statusLabel: string
  expiry: ExpiryReason
  categories: CategorySlug[]
  match: PersonalMatch
  deadline: DeadlineView
}

export interface EvaluationContext extends ValuationContext, CategoryContext {
  profile: ProfilePreferences
  displayTimeZone: string | null
  /** Peer cash prices keyed by peerKey(deal). */
  peerPrices?: ReadonlyMap<string, number[]>
}

/** Groups deals that sell the same product so their cash prices can be compared. */
export function peerKey(deal: Pick<Deal, 'kind' | 'originAirport' | 'destination' | 'flight' | 'hotel'>): string {
  if (deal.kind === 'flight' && deal.flight) return `f:${deal.originAirport ?? '?'}-${deal.destination.airport ?? '?'}:${deal.flight.cabin}`
  if (deal.kind === 'hotel' && deal.hotel) return `h:${deal.hotel.property.toLowerCase()}:${deal.hotel.roomType}`
  return `x:${deal.destination.city.toLowerCase()}`
}

export function evaluateDeal(deal: Deal, ctx: EvaluationContext): EvaluatedDeal {
  const peers = ctx.peerPrices?.get(peerKey(deal))?.filter((p) => p !== deal.comparableCashUsd)
  const valuation = valueDeal(deal, { ...ctx, peerCashPrices: peers })
  const status = computeStatus(deal, ctx.now)
  const categories = dealCategories(deal, valuation, ctx)
  return {
    deal,
    valuation,
    status,
    statusLabel: EVIDENCE_LABELS[status],
    expiry: expiryReason(deal, ctx.now),
    categories,
    match: personalMatch(deal, ctx.profile, categories),
    deadline: describeDeadline(deal, ctx.now, ctx.displayTimeZone),
  }
}

/** Build peer price lists from a set of deals (each deal's own price is filtered out at evaluation). */
export function buildPeerPrices(deals: readonly Deal[]): Map<string, number[]> {
  const map = new Map<string, number[]>()
  for (const d of deals) {
    if (d.comparableCashUsd == null || d.sourceKind === 'demo') continue
    const k = peerKey(d)
    const list = map.get(k) ?? []
    list.push(d.comparableCashUsd)
    map.set(k, list)
  }
  return map
}
