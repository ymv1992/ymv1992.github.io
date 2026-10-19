import { CHASE_TRAVEL_PROGRAM_ID, cardCanTransfer, type CardType } from '../domain/constants'
import type { TransferPartner, TransferPromotion, TransferRatio } from '../domain/types'

/** Ratio for a given card. Card-specific overrides (e.g. Hyatt 4:3 on some cards) win over the base ratio. */
export function effectiveRatio(partner: TransferPartner, card: CardType): TransferRatio {
  return partner.cardRatioOverrides[card] ?? partner.baseRatio
}

export function formatRatio(r: TransferRatio): string {
  return `${r.chase}:${r.partner}`
}

export function isPromotionActive(promo: TransferPromotion, at: Date): boolean {
  if (promo.startsAt.getTime() > at.getTime()) return false
  if (promo.endsAt && promo.endsAt.getTime() < at.getTime()) return false
  return true
}

export function isPromotionEligible(promo: TransferPromotion, card: CardType): boolean {
  if (!cardCanTransfer(card)) return false
  return promo.eligibleCardTypes === null || promo.eligibleCardTypes.includes(card)
}

/**
 * Best currently active promotion for a partner that the card is eligible for.
 * Targeted promotions are excluded because eligibility cannot be confirmed automatically.
 */
export function activePromotion(
  partnerId: string,
  promotions: readonly TransferPromotion[],
  card: CardType,
  at: Date,
): TransferPromotion | null {
  let best: TransferPromotion | null = null
  for (const p of promotions) {
    if (p.partnerId !== partnerId || p.isTargeted) continue
    if (!isPromotionActive(p, at) || !isPromotionEligible(p, card)) continue
    if (!best || p.bonusPercent > best.bonusPercent) best = p
  }
  return best
}

function roundBy(value: number, mode: TransferPartner['bonusRounding']): number {
  // Small epsilon guards against binary floating point (e.g. 0.29 * 100).
  if (mode === 'ceil') return Math.ceil(value - 1e-9)
  if (mode === 'round') return Math.round(value)
  return Math.floor(value + 1e-9)
}

export interface TransferResult {
  base: number
  bonus: number
  total: number
}

/** Partner points received for a given number of Chase points. */
export function partnerPointsReceived(
  chasePoints: number,
  ratio: TransferRatio,
  bonusPercent: number,
  rounding: TransferPartner['bonusRounding'] = 'floor',
): TransferResult {
  if (chasePoints <= 0) return { base: 0, bonus: 0, total: 0 }
  const base = Math.floor((chasePoints * ratio.partner) / ratio.chase + 1e-9)
  const bonus = bonusPercent > 0 ? roundBy((base * bonusPercent) / 100, rounding) : 0
  return { base, bonus, total: base + bonus }
}

export interface ChasePointsRequirementInput {
  partnerPointsNeeded: number
  existingPartnerBalance?: number
  ratio: TransferRatio
  bonusPercent: number
  minTransfer: number
  transferIncrement: number
  rounding?: TransferPartner['bonusRounding']
}

export interface ChasePointsRequirement {
  /** Chase points to transfer (a multiple of the increment, at least the minimum, or 0). */
  chasePoints: number
  partnerReceived: number
  basePartnerPoints: number
  bonusPartnerPoints: number
  /** Partner points left over after the award is booked. */
  surplusPartnerPoints: number
  /** Chase points needed before rounding up to the transfer increment. */
  unroundedChasePoints: number
}

/**
 * Smallest valid Chase transfer that covers an award, accounting for ratio,
 * promotional bonus, minimum transfer, transfer increments and partner rounding.
 */
export function chasePointsRequired(input: ChasePointsRequirementInput): ChasePointsRequirement {
  const rounding = input.rounding ?? 'floor'
  const increment = Math.max(1, Math.floor(input.transferIncrement))
  const minimum = Math.max(increment, Math.floor(input.minTransfer))
  const need = Math.max(0, Math.ceil(input.partnerPointsNeeded) - Math.max(0, input.existingPartnerBalance ?? 0))
  if (need === 0) {
    return {
      chasePoints: 0,
      partnerReceived: 0,
      basePartnerPoints: 0,
      bonusPartnerPoints: 0,
      surplusPartnerPoints: Math.max(0, (input.existingPartnerBalance ?? 0) - input.partnerPointsNeeded),
      unroundedChasePoints: 0,
    }
  }
  const multiplier = (input.ratio.partner / input.ratio.chase) * (1 + Math.max(0, input.bonusPercent) / 100)
  const unrounded = Math.ceil(need / multiplier - 1e-9)
  let chase = Math.max(minimum, Math.ceil(unrounded / increment) * increment)
  // Rounding of the base and bonus can leave us a few points short; step up until covered.
  let received = partnerPointsReceived(chase, input.ratio, input.bonusPercent, rounding)
  let guard = 0
  while (received.total < need && guard++ < 10_000) {
    chase += increment
    received = partnerPointsReceived(chase, input.ratio, input.bonusPercent, rounding)
  }
  // And step down if a smaller valid transfer still covers it.
  while (chase - increment >= minimum) {
    const lower = partnerPointsReceived(chase - increment, input.ratio, input.bonusPercent, rounding)
    if (lower.total < need) break
    chase -= increment
    received = lower
  }
  return {
    chasePoints: chase,
    partnerReceived: received.total,
    basePartnerPoints: received.base,
    bonusPartnerPoints: received.bonus,
    surplusPartnerPoints: received.total + Math.max(0, input.existingPartnerBalance ?? 0) - input.partnerPointsNeeded,
    unroundedChasePoints: unrounded,
  }
}

export interface TransferQuote {
  programId: string
  partnerName: string | null
  isChaseTravel: boolean
  ratio: TransferRatio | null
  bonusPercent: number
  bonusSource: 'promotion' | 'illustrative' | 'none'
  promotion: TransferPromotion | null
  requirement: ChasePointsRequirement
  cardCanTransfer: boolean
  processingTime: string | null
  warnings: string[]
}

export interface QuoteInput {
  programId: string
  programPoints: number
  partners: ReadonlyMap<string, TransferPartner>
  promotions: readonly TransferPromotion[]
  card: CardType
  at: Date
  existingPartnerBalance?: number
  /** Demo-only illustrative bonus. Real deals must pass null. */
  illustrativeBonusPercent?: number | null
  /** Manually entered bonus in the calculator (e.g. a targeted offer the owner received). */
  manualBonusPercent?: number | null
}

/** Full quote for paying an award with Chase points. Returns null when the program is unknown. */
export function quoteTransfer(input: QuoteInput): TransferQuote | null {
  if (input.programId === CHASE_TRAVEL_PROGRAM_ID) {
    return {
      programId: input.programId,
      partnerName: 'Chase Travel',
      isChaseTravel: true,
      ratio: null,
      bonusPercent: 0,
      bonusSource: 'none',
      promotion: null,
      requirement: {
        chasePoints: input.programPoints,
        partnerReceived: 0,
        basePartnerPoints: 0,
        bonusPartnerPoints: 0,
        surplusPartnerPoints: 0,
        unroundedChasePoints: input.programPoints,
      },
      cardCanTransfer: true,
      processingTime: null,
      warnings: [],
    }
  }
  const partner = input.partners.get(input.programId)
  if (!partner) return null
  const warnings: string[] = []
  const canTransfer = cardCanTransfer(input.card)
  if (!canTransfer) {
    warnings.push(
      'Your selected Chase card cannot transfer points to partners on its own. Points must be combined with a Sapphire Preferred, Sapphire Reserve or Ink Business Preferred account first.',
    )
  }
  if (!partner.active) warnings.push(`${partner.name} is not listed as an active Chase transfer partner.`)
  if (partner.verificationStatus !== 'official_verified' && partner.verificationStatus !== 'owner_verified') {
    warnings.push('Transfer ratio comes from research, not a confirmed Chase source. Confirm it in your Chase account before transferring.')
  }
  const ratio = effectiveRatio(partner, input.card)
  const promo = activePromotion(partner.id, input.promotions, input.card, input.at)
  let bonusPercent = 0
  let bonusSource: TransferQuote['bonusSource'] = 'none'
  if (input.manualBonusPercent != null && input.manualBonusPercent > 0) {
    bonusPercent = input.manualBonusPercent
    bonusSource = 'promotion'
  } else if (promo) {
    bonusPercent = promo.bonusPercent
    bonusSource = 'promotion'
  } else if (input.illustrativeBonusPercent != null && input.illustrativeBonusPercent > 0) {
    bonusPercent = input.illustrativeBonusPercent
    bonusSource = 'illustrative'
    warnings.push(`Uses an illustrative ${input.illustrativeBonusPercent}% transfer bonus for demonstration. It is not a real promotion.`)
  }
  const requirement = chasePointsRequired({
    partnerPointsNeeded: input.programPoints,
    existingPartnerBalance: input.existingPartnerBalance,
    ratio,
    bonusPercent,
    minTransfer: partner.minTransfer,
    transferIncrement: partner.transferIncrement,
    rounding: partner.bonusRounding,
  })
  return {
    programId: partner.id,
    partnerName: partner.name,
    isChaseTravel: false,
    ratio,
    bonusPercent,
    bonusSource,
    promotion: bonusSource === 'promotion' && input.manualBonusPercent == null ? promo : null,
    requirement,
    cardCanTransfer: canTransfer,
    processingTime: partner.processingTime,
    warnings,
  }
}

export interface PromotionAssessment {
  verdict: 'strong' | 'useful' | 'weak' | 'poor'
  effectivePartnerPointsPerChasePoint: number
  explanation: string
}

/**
 * Judges whether a bonus actually produces good value, given a typical value
 * of the partner currency. A big bonus on a weak currency can still be poor.
 */
export function assessPromotion(
  bonusPercent: number,
  ratio: TransferRatio,
  typicalPartnerValueCents: number | null,
  chaseFloorCents: number,
): PromotionAssessment {
  const perPoint = (ratio.partner / ratio.chase) * (1 + bonusPercent / 100)
  if (typicalPartnerValueCents == null) {
    return {
      verdict: 'useful',
      effectivePartnerPointsPerChasePoint: perPoint,
      explanation: `Each Chase point becomes ${perPoint.toFixed(2)} partner points. No reliable value estimate for this currency, so judge it against a specific award.`,
    }
  }
  const implied = perPoint * typicalPartnerValueCents
  const verdict: PromotionAssessment['verdict'] =
    implied >= chaseFloorCents * 1.75 ? 'strong' : implied >= chaseFloorCents * 1.25 ? 'useful' : implied >= chaseFloorCents ? 'weak' : 'poor'
  return {
    verdict,
    effectivePartnerPointsPerChasePoint: perPoint,
    explanation: `${perPoint.toFixed(2)} partner points per Chase point × ~${typicalPartnerValueCents.toFixed(2)}¢ typical value ≈ ${implied.toFixed(2)}¢ per Chase point (your floor is ${chaseFloorCents.toFixed(2)}¢).`,
  }
}

export interface TransferAdviceInput {
  quote: TransferQuote
  chaseBalance: number
  cpp: number | null
  pointFloorCents: number
  minAcceptableCpp: number
  /** Award availability confirmed on the official site (or a live provider) recently. */
  availabilityConfirmed: boolean
}

export interface TransferAdvice {
  verdict: 'advisable_after_verifying' | 'marginal' | 'not_advisable' | 'insufficient_info'
  label: string
  reasons: string[]
}

/**
 * Whether transferring makes sense. Never recommends a speculative transfer:
 * even a great value is only advisable once availability is confirmed.
 */
export function transferAdvice(i: TransferAdviceInput): TransferAdvice {
  const reasons: string[] = []
  const needed = i.quote.requirement.chasePoints
  if (!i.quote.cardCanTransfer) {
    return { verdict: 'not_advisable', label: 'Not possible with this card', reasons: ['Your card type cannot transfer to partners. Combine points with a transfer-eligible card first.'] }
  }
  if (needed > i.chaseBalance) {
    return { verdict: 'not_advisable', label: 'Not enough points', reasons: [`You need ${needed.toLocaleString('en-US')} Chase points but have ${i.chaseBalance.toLocaleString('en-US')}.`] }
  }
  if (i.cpp == null) {
    return { verdict: 'insufficient_info', label: 'Cannot judge value yet', reasons: ['Enter the comparable cash price and taxes to calculate value per point.'] }
  }
  if (i.cpp < i.pointFloorCents) {
    return {
      verdict: 'not_advisable',
      label: 'Poor value',
      reasons: [`${i.cpp.toFixed(2)}¢ per point is below your ${i.pointFloorCents.toFixed(2)}¢ floor — redeeming another way is better.`],
    }
  }
  if (i.quote.bonusSource === 'illustrative') reasons.push('The bonus used here is illustrative, not a real promotion.')
  if (!i.availabilityConfirmed) reasons.push('Confirm award availability on the partner site before transferring — transfers are usually irreversible.')
  if (i.quote.requirement.surplusPartnerPoints > 0) {
    reasons.push(`${i.quote.requirement.surplusPartnerPoints.toLocaleString('en-US')} partner points will be left over because of transfer increments.`)
  }
  if (i.cpp < i.minAcceptableCpp) {
    return { verdict: 'marginal', label: 'Marginal value', reasons: [`${i.cpp.toFixed(2)}¢ per point is under your ${i.minAcceptableCpp.toFixed(2)}¢ target.`, ...reasons] }
  }
  return {
    verdict: 'advisable_after_verifying',
    label: i.availabilityConfirmed ? 'Good value — transfer when ready to book' : 'Good value — only after confirming availability',
    reasons: [`${i.cpp.toFixed(2)}¢ per point beats your ${i.minAcceptableCpp.toFixed(2)}¢ target.`, ...reasons],
  }
}
