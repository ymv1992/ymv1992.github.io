import { describe, expect, it } from 'vitest'
import {
  activePromotion,
  assessPromotion,
  chasePointsRequired,
  partnerPointsReceived,
  quoteTransfer,
  transferAdvice,
} from '@/lib/engine/transfer'
import { NOW, partner, partnersMap, promo, testHotelPartner } from '../fixtures'

const oneToOne = { chase: 1, partner: 1 }

describe('partnerPointsReceived', () => {
  it('applies ratio then bonus', () => {
    expect(partnerPointsReceived(60_000, oneToOne, 25)).toEqual({ base: 60_000, bonus: 15_000, total: 75_000 })
  })
  it('handles 4:3 ratios', () => {
    expect(partnerPointsReceived(40_000, { chase: 4, partner: 3 }, 0)).toEqual({ base: 30_000, bonus: 0, total: 30_000 })
  })
  it('respects bonus rounding modes', () => {
    expect(partnerPointsReceived(1_000, oneToOne, 33.33, 'floor').bonus).toBe(333)
    expect(partnerPointsReceived(1_000, oneToOne, 33.33, 'ceil').bonus).toBe(334)
    expect(partnerPointsReceived(1_000, oneToOne, 33.35, 'round').bonus).toBe(334)
  })
  it('avoids floating point drift (29% of 1,000 = 290)', () => {
    expect(partnerPointsReceived(1_000, oneToOne, 29).bonus).toBe(290)
  })
})

describe('chasePointsRequired', () => {
  const base = { ratio: oneToOne, minTransfer: 1000, transferIncrement: 1000 }

  it('spec example: 75,000 miles with a 25% bonus needs 60,000 Chase points', () => {
    const r = chasePointsRequired({ ...base, partnerPointsNeeded: 75_000, bonusPercent: 25 })
    expect(r.chasePoints).toBe(60_000)
    expect(r.partnerReceived).toBe(75_000)
    expect(r.bonusPartnerPoints).toBe(15_000)
    expect(r.surplusPartnerPoints).toBe(0)
  })

  it('rounds up to the transfer increment', () => {
    const r = chasePointsRequired({ ...base, partnerPointsNeeded: 76_500, bonusPercent: 25 })
    expect(r.unroundedChasePoints).toBe(61_200)
    expect(r.chasePoints).toBe(62_000)
    expect(r.partnerReceived).toBe(77_500)
    expect(r.surplusPartnerPoints).toBe(1_000)
  })

  it('enforces the minimum transfer', () => {
    const r = chasePointsRequired({ ...base, partnerPointsNeeded: 300, bonusPercent: 0, minTransfer: 1000 })
    expect(r.chasePoints).toBe(1_000)
  })

  it('steps up when bonus rounding leaves a shortfall', () => {
    // 1,000 → 1,000 + floor(1,000 × 0.333) = 1,333 < 1,334 needed.
    const r = chasePointsRequired({ ...base, partnerPointsNeeded: 1_334, bonusPercent: 33.3 })
    expect(r.partnerReceived).toBeGreaterThanOrEqual(1_334)
    expect(r.chasePoints).toBe(2_000)
  })

  it('subtracts an existing partner balance', () => {
    const r = chasePointsRequired({ ...base, partnerPointsNeeded: 75_000, existingPartnerBalance: 20_000, bonusPercent: 0 })
    expect(r.chasePoints).toBe(55_000)
    const none = chasePointsRequired({ ...base, partnerPointsNeeded: 10_000, existingPartnerBalance: 12_000, bonusPercent: 0 })
    expect(none.chasePoints).toBe(0)
    expect(none.surplusPartnerPoints).toBe(2_000)
  })

  it('handles 4:3 ratios with increments', () => {
    const r = chasePointsRequired({ partnerPointsNeeded: 25_000, ratio: { chase: 4, partner: 3 }, bonusPercent: 0, minTransfer: 1000, transferIncrement: 1000 })
    // 25,000 × 4/3 = 33,333.3 → 34,000 → 25,500 received
    expect(r.chasePoints).toBe(34_000)
    expect(r.partnerReceived).toBe(25_500)
  })

  it('handles non-1,000 increments', () => {
    const r = chasePointsRequired({ partnerPointsNeeded: 1_250, ratio: oneToOne, bonusPercent: 0, minTransfer: 500, transferIncrement: 500 })
    expect(r.chasePoints).toBe(1_500)
  })
})

describe('promotions', () => {
  it('picks the best active, eligible, non-targeted promotion', () => {
    const promos = [
      promo({ id: 'a', bonusPercent: 20 }),
      promo({ id: 'b', bonusPercent: 40, isTargeted: true }),
      promo({ id: 'c', bonusPercent: 30, eligibleCardTypes: ['sapphire_reserve'] }),
      promo({ id: 'd', bonusPercent: 50, startsAt: new Date('2026-11-01T00:00:00Z') }),
      promo({ id: 'e', bonusPercent: 60, endsAt: new Date('2026-10-01T00:00:00Z') }),
    ]
    expect(activePromotion('test_air', promos, 'sapphire_reserve', NOW)?.id).toBe('c')
    expect(activePromotion('test_air', promos, 'sapphire_preferred', NOW)?.id).toBe('a')
    expect(activePromotion('test_air', promos, 'freedom_unlimited', NOW)).toBeNull()
  })

  it('judges big bonuses on weak currencies as poor', () => {
    const a = assessPromotion(70, oneToOne, 0.6, 1.25)
    expect(a.verdict).toBe('poor')
    const b = assessPromotion(30, oneToOne, 1.5, 1.0)
    expect(b.verdict).toBe('strong')
  })
})

describe('quoteTransfer', () => {
  it('warns when the card cannot transfer', () => {
    const q = quoteTransfer({
      programId: 'test_air',
      programPoints: 10_000,
      partners: partnersMap(partner()),
      promotions: [],
      card: 'freedom_unlimited',
      at: NOW,
    })
    expect(q?.cardCanTransfer).toBe(false)
    expect(q?.warnings.join(' ')).toMatch(/cannot transfer/)
  })

  it('warns when the partner data is research-only', () => {
    const q = quoteTransfer({
      programId: 'test_air',
      programPoints: 10_000,
      partners: partnersMap(partner({ verificationStatus: 'research_seed' })),
      promotions: [],
      card: 'sapphire_reserve',
      at: NOW,
    })
    expect(q?.warnings.join(' ')).toMatch(/Confirm it in your Chase account/)
  })

  it('uses card overrides', () => {
    const q = quoteTransfer({
      programId: 'test_hotel',
      programPoints: 30_000,
      partners: partnersMap(testHotelPartner),
      promotions: [],
      card: 'sapphire_preferred',
      at: NOW,
    })
    expect(q?.ratio).toEqual({ chase: 4, partner: 3 })
    expect(q?.requirement.chasePoints).toBe(40_000)
  })

  it('returns null for unknown programs', () => {
    expect(quoteTransfer({ programId: 'x', programPoints: 1, partners: new Map(), promotions: [], card: 'sapphire_reserve', at: NOW })).toBeNull()
  })
})

describe('transferAdvice', () => {
  const quote = quoteTransfer({ programId: 'test_air', programPoints: 75_000, partners: partnersMap(partner()), promotions: [promo()], card: 'sapphire_reserve', at: NOW })!
  const base = { quote, chaseBalance: 150_000, cpp: 8.37, pointFloorCents: 1, minAcceptableCpp: 1.5, availabilityConfirmed: false }

  it('never recommends a speculative transfer', () => {
    const a = transferAdvice(base)
    expect(a.verdict).toBe('advisable_after_verifying')
    expect(a.label).toMatch(/only after confirming availability/)
    expect(a.reasons.join(' ')).toMatch(/irreversible/)
  })
  it('flags poor and marginal value', () => {
    expect(transferAdvice({ ...base, cpp: 0.8 }).verdict).toBe('not_advisable')
    expect(transferAdvice({ ...base, cpp: 1.2 }).verdict).toBe('marginal')
  })
  it('requires enough points, a transfer-capable card and a known value', () => {
    expect(transferAdvice({ ...base, chaseBalance: 10_000 }).label).toBe('Not enough points')
    expect(transferAdvice({ ...base, cpp: null }).verdict).toBe('insufficient_info')
    const noTransfer = quoteTransfer({ programId: 'test_air', programPoints: 75_000, partners: partnersMap(partner()), promotions: [], card: 'freedom_flex', at: NOW })!
    expect(transferAdvice({ ...base, quote: noTransfer }).label).toBe('Not possible with this card')
  })
})
