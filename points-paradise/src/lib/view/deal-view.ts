import { CABIN_LABELS, CATEGORY_DEFS, ROOM_TYPE_LABELS, SEAT_TYPE_LABELS, type EvidenceStatus } from '../domain/constants'
import type { EvaluatedDeal } from '../engine/evaluate'
import { formatAge } from '../engine/status'
import { compactPoints, dateRange } from '../format'

export interface DealCardData {
  id: string
  kind: string
  title: string
  city: string
  country: string
  provider: string
  productLine: string
  categoryLabels: string[]
  dates: string
  chasePoints: number | null
  programPoints: number | null
  programName: string | null
  mandatoryCashUsd: number | null
  comparableCashUsd: number | null
  cpp: number | null
  headlineCpp: number | null
  notCalculableReason: string | null
  confidence: 'high' | 'medium' | 'low'
  rank: number | null
  status: EvidenceStatus
  statusLabel: string
  lastVerified: string
  deadlineType: string
  deadlineHeadline: string
  deadlineAtIso: string | null
  availabilityRisk: { level: 'low' | 'medium' | 'high' | 'unknown'; label: string }
  why: string
  tags: string[]
  imageUrl: string | null
  imageCredit: string | null
  isDemo: boolean
  matchScore: number
  bonusLabel: string | null
  /** Short labels for valuation flags the owner should notice before trusting the number. */
  warnings: string[]
  saved: boolean
}

const WARNING_LABELS: Partial<Record<string, string>> = {
  inflated_vs_peers: 'Cash price looks inflated',
  weak_cash_source: 'Weak cash comparison',
  unusually_high_cpp: 'Unusually high — double-check',
  negative_value: 'Paying cash is better',
  below_floor: 'Below your value floor',
  card_cannot_transfer: 'Your card cannot transfer',
  stale_cash_price: 'Cash price is old',
}

/** Rough risk that the award has disappeared, from evidence age and deadline type only. */
export function availabilityRisk(e: EvaluatedDeal): DealCardData['availabilityRisk'] {
  if (e.status === 'demo') return { level: 'unknown', label: 'Demo — not real' }
  if (e.deadline.type === 'estimated') return { level: 'high', label: 'High — historically short-lived' }
  switch (e.status) {
    case 'verified_live':
      return { level: 'low', label: 'Low — checked within 6 hours' }
    case 'recently_verified':
      return { level: 'medium', label: 'Medium — checked within 3 days' }
    case 'cached':
      return { level: 'high', label: 'High — last check is old' }
    default:
      return { level: 'unknown', label: 'Unknown — not yet verified' }
  }
}

export function productLine(e: EvaluatedDeal): string {
  const d = e.deal
  if (d.flight) {
    const seat = d.flight.seatType !== 'unknown' ? ` · ${SEAT_TYPE_LABELS[d.flight.seatType]}` : ''
    const stops = d.flight.stops == null ? '' : d.flight.stops === 0 ? ' · Nonstop' : ` · ${d.flight.stops} stop${d.flight.stops > 1 ? 's' : ''}`
    return `${CABIN_LABELS[d.flight.cabin]}${seat}${stops}${d.originAirport ? ` · from ${d.originAirport}` : ''}`
  }
  if (d.hotel) return `${d.hotel.roomCategory ?? ROOM_TYPE_LABELS[d.hotel.roomType]}${d.nights ? ` · ${d.nights} nights` : ''}`
  return d.kind
}

const CATEGORY_LABEL = new Map(CATEGORY_DEFS.map((c) => [c.slug, c.label]))

export function defaultWhy(e: EvaluatedDeal): string {
  const v = e.valuation
  if (e.deal.whyNoteworthy) return e.deal.whyNoteworthy
  if (v.headlineCpp != null && v.chasePoints != null && e.deal.comparableCashUsd != null) {
    return `${compactPoints(v.chasePoints)} Chase points replace a $${Math.round(e.deal.comparableCashUsd).toLocaleString('en-US')} cash price — about ${(v.practicalCpp ?? v.headlineCpp).toFixed(1)}¢ per point.`
  }
  return 'Value cannot be reliably calculated yet — add the missing details to rank it.'
}

export function toCardData(e: EvaluatedDeal, opts: { now: Date; rank: number | null; saved: boolean; programName: string | null }): DealCardData {
  const v = e.valuation
  return {
    id: e.deal.id,
    kind: e.deal.kind,
    title: e.deal.title,
    city: e.deal.destination.city,
    country: e.deal.destination.country,
    provider: e.deal.providerName,
    productLine: productLine(e),
    categoryLabels: e.categories.map((c) => CATEGORY_LABEL.get(c) ?? c).slice(0, 3),
    dates: dateRange(e.deal.travelStart, e.deal.flexibleDates ? e.deal.travelEnd : (e.deal.travelEnd ?? null)),
    chasePoints: v.chasePoints,
    programPoints: e.deal.programPoints,
    programName: opts.programName,
    mandatoryCashUsd: e.deal.mandatoryCashUsd,
    comparableCashUsd: e.deal.comparableCashUsd,
    cpp: v.practicalCpp ?? v.headlineCpp,
    headlineCpp: v.headlineCpp,
    notCalculableReason: v.calculable ? null : (v.reasons[0] ?? 'Value cannot be reliably calculated'),
    confidence: v.confidence,
    rank: opts.rank,
    status: e.status,
    statusLabel: e.statusLabel,
    lastVerified: e.deal.sourceKind === 'demo' ? 'Never — fictional demo' : e.deal.lastVerifiedAt ? formatAge(e.deal.lastVerifiedAt, opts.now) : 'Not yet verified',
    deadlineType: e.deadline.type,
    deadlineHeadline: e.deadline.headline,
    deadlineAtIso: e.deadline.type === 'confirmed' && e.deadline.at ? e.deadline.at.toISOString() : null,
    availabilityRisk: availabilityRisk(e),
    why: defaultWhy(e),
    tags: e.deal.tags,
    imageUrl: e.deal.imageUrl,
    imageCredit: e.deal.imageCredit,
    isDemo: e.deal.sourceKind === 'demo',
    matchScore: e.match.score,
    bonusLabel: v.transfer?.bonusPercent ? `${v.transfer.bonusPercent}% ${v.transfer.bonusSource === 'illustrative' ? 'illustrative ' : ''}bonus` : null,
    warnings: v.flags.map((f) => WARNING_LABELS[f.code]).filter((x): x is string => !!x),
    saved: opts.saved,
  }
}
