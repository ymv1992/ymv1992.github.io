import { type CardType } from '../domain/constants'
import type { Deal, TransferPartner, TransferPromotion } from '../domain/types'
import { checkComparability, type ComparabilityResult } from './comparability'
import { quoteTransfer, type TransferQuote } from './transfer'

/**
 * Cents per Chase point:
 *   CPP = ((comparable cash price − mandatory cash costs) ÷ Chase points) × 100
 * Returns null when any input is missing or points are not positive.
 */
export function computeCpp(comparableCashUsd: number | null, mandatoryCashUsd: number | null, chasePoints: number | null): number | null {
  if (comparableCashUsd == null || mandatoryCashUsd == null || chasePoints == null) return null
  if (!Number.isFinite(comparableCashUsd) || !Number.isFinite(mandatoryCashUsd) || !Number.isFinite(chasePoints)) return null
  if (chasePoints <= 0) return null
  return ((comparableCashUsd - mandatoryCashUsd) / chasePoints) * 100
}

export function median(values: readonly number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).slice().sort((a, b) => a - b)
  if (v.length === 0) return null
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2
}

export type ValuationFlagCode =
  | 'inflated_vs_peers'
  | 'weak_cash_source'
  | 'unusually_high_cpp'
  | 'negative_value'
  | 'below_floor'
  | 'comparability_minor'
  | 'card_cannot_transfer'
  | 'illustrative_bonus'
  | 'stale_cash_price'

export interface ValuationFlag {
  code: ValuationFlagCode
  message: string
}

export interface Valuation {
  calculable: boolean
  /** Human-readable reasons when value cannot be reliably calculated. */
  reasons: string[]
  chasePoints: number | null
  transfer: TransferQuote | null
  headlineCpp: number | null
  practicalCpp: number | null
  practicalCashUsd: number | null
  /** Cash you avoid paying: comparable price minus mandatory cash. */
  cashSavingsUsd: number | null
  comparability: ComparabilityResult
  flags: ValuationFlag[]
  confidence: 'high' | 'medium' | 'low'
}

export interface ValuationContext {
  now: Date
  card: CardType
  partners: ReadonlyMap<string, TransferPartner>
  promotions: readonly TransferPromotion[]
  /** Comparable cash observations for the same route+cabin or property, used to spot inflated prices. */
  peerCashPrices?: readonly number[]
  partnerBalances?: Readonly<Record<string, number>>
  /** Owner's minimum value per point (opportunity cost), e.g. 1.0¢. */
  pointFloorCents: number
}

const UNUSUALLY_HIGH_CPP = 12
const STALE_CASH_DAYS = 14

export function valueDeal(deal: Deal, ctx: ValuationContext): Valuation {
  const reasons: string[] = []
  const flags: ValuationFlag[] = []
  const comparability = checkComparability(deal)

  let transfer: TransferQuote | null = null
  let chasePoints: number | null = null
  if (deal.programId && deal.programPoints != null && deal.programPoints > 0) {
    const quoteBase = {
      programId: deal.programId,
      programPoints: deal.programPoints,
      partners: ctx.partners,
      promotions: ctx.promotions,
      card: ctx.card,
      at: ctx.now,
      illustrativeBonusPercent: deal.sourceKind === 'demo' ? deal.assumedBonusPercent : null,
    }
    // Value is measured on the full award cost so deals stay comparable; the transfer
    // shown to the owner subtracts any miles already sitting in the partner account.
    const fullQuote = quoteTransfer(quoteBase)
    const balance = ctx.partnerBalances?.[deal.programId] ?? 0
    transfer = balance > 0 ? quoteTransfer({ ...quoteBase, existingPartnerBalance: balance }) : fullQuote
    if (transfer && fullQuote) {
      chasePoints = fullQuote.requirement.chasePoints
      if (!transfer.cardCanTransfer && !transfer.isChaseTravel) {
        flags.push({ code: 'card_cannot_transfer', message: 'Your card type cannot transfer to partners without combining points.' })
      }
      if (transfer.bonusSource === 'illustrative') {
        flags.push({ code: 'illustrative_bonus', message: `Includes an illustrative ${transfer.bonusPercent}% bonus (demo only).` })
      }
    } else {
      reasons.push(`Unknown points program "${deal.programId}", so the Chase points required cannot be calculated.`)
    }
  } else {
    reasons.push('Points price is missing.')
  }

  if (deal.comparableCashUsd == null) reasons.push('No comparable cash price recorded.')
  if (deal.mandatoryCashUsd == null) reasons.push('Taxes, fees and mandatory cash costs are unknown.')
  if (!comparability.comparable) {
    for (const issue of comparability.issues.filter((i) => i.severity === 'major')) reasons.push(`Not a like-for-like comparison: ${issue.message}`)
  }

  const headline = reasons.length === 0 ? computeCpp(deal.comparableCashUsd, deal.mandatoryCashUsd, chasePoints) : null
  if (headline == null && reasons.length === 0) reasons.push('Value cannot be reliably calculated from the available data.')

  // Practical value: the realistic amount you would otherwise pay.
  let practicalCash: number | null = deal.comparableCashUsd
  if (practicalCash != null && deal.alternativeCashUsd != null && deal.alternativeCashUsd > 0) {
    practicalCash = Math.min(practicalCash, deal.alternativeCashUsd)
  }
  const peers = (ctx.peerCashPrices ?? []).filter((p) => p > 0)
  const peerMedian = peers.length >= 3 ? median(peers) : null
  if (peerMedian != null && deal.comparableCashUsd != null && deal.comparableCashUsd > peerMedian * 2) {
    flags.push({
      code: 'inflated_vs_peers',
      message: `Cash price is more than double the median of ${peers.length} similar observations ($${Math.round(peerMedian).toLocaleString('en-US')}).`,
    })
    practicalCash = practicalCash == null ? peerMedian : Math.min(practicalCash, peerMedian)
  }
  if (deal.comparableCashSource === 'rack_rate' || deal.comparableCashSource === 'unknown' || deal.comparableCashSource === 'estimate') {
    flags.push({
      code: 'weak_cash_source',
      message:
        deal.comparableCashSource === 'rack_rate'
          ? 'Cash price is an advertised rack rate, which may overstate what you would really pay.'
          : 'Cash price source is weak or unknown; treat the value as approximate.',
    })
  }
  if (
    deal.comparableCashObservedAt &&
    ctx.now.getTime() - deal.comparableCashObservedAt.getTime() > STALE_CASH_DAYS * 86_400_000 &&
    deal.sourceKind !== 'demo'
  ) {
    flags.push({ code: 'stale_cash_price', message: `Cash price was observed more than ${STALE_CASH_DAYS} days ago.` })
  }
  const practical = headline != null ? computeCpp(practicalCash, deal.mandatoryCashUsd, chasePoints) : null

  if (headline != null) {
    if (headline <= 0) flags.push({ code: 'negative_value', message: 'Mandatory cash costs exceed the cash price — paying cash is better.' })
    else if ((practical ?? headline) < ctx.pointFloorCents)
      flags.push({
        code: 'below_floor',
        message: `Below your ${ctx.pointFloorCents.toFixed(2)}¢ floor — you could get more by redeeming points another way.`,
      })
    if (headline > UNUSUALLY_HIGH_CPP)
      flags.push({ code: 'unusually_high_cpp', message: 'Unusually high value — double-check the cash comparison before relying on it.' })
  }
  const minor = comparability.issues.filter((i) => i.severity !== 'major')
  if (minor.length > 0) flags.push({ code: 'comparability_minor', message: minor.map((i) => i.message).join(' ') })

  let confidence: Valuation['confidence'] = 'high'
  if (headline == null) confidence = 'low'
  else {
    const downgrade = flags.filter((f) => ['inflated_vs_peers', 'weak_cash_source', 'comparability_minor', 'stale_cash_price', 'unusually_high_cpp'].includes(f.code)).length
    const missing = comparability.issues.some((i) => i.severity === 'missing')
    if (downgrade >= 2 || (downgrade >= 1 && missing)) confidence = 'low'
    else if (downgrade === 1 || missing) confidence = 'medium'
  }

  return {
    calculable: headline != null,
    reasons,
    chasePoints,
    transfer,
    headlineCpp: headline,
    practicalCpp: practical,
    practicalCashUsd: headline != null ? practicalCash : null,
    cashSavingsUsd: deal.comparableCashUsd != null && deal.mandatoryCashUsd != null ? deal.comparableCashUsd - deal.mandatoryCashUsd : null,
    comparability,
    flags,
    confidence,
  }
}

export function formatCpp(cpp: number | null): string {
  if (cpp == null) return '—'
  return `${cpp.toFixed(2)}¢`
}
