import { describe, expect, it } from 'vitest'
import { computeCpp, valueDeal } from '@/lib/engine/valuation'
import { evalCtx, flightDeal, hotelDeal, partner, partnersMap, promo } from '../fixtures'

describe('computeCpp', () => {
  it('matches the specification example: ($5,000 − $200) ÷ 60,000 × 100 = 8.0¢', () => {
    expect(computeCpp(5000, 200, 60000)).toBeCloseTo(8.0, 10)
  })

  it('returns null for missing or non-positive points', () => {
    expect(computeCpp(null, 200, 60000)).toBeNull()
    expect(computeCpp(5000, null, 60000)).toBeNull()
    expect(computeCpp(5000, 200, null)).toBeNull()
    expect(computeCpp(5000, 200, 0)).toBeNull()
    expect(computeCpp(5000, 200, -1)).toBeNull()
  })

  it('can be negative when fees exceed the cash price', () => {
    expect(computeCpp(100, 300, 10000)).toBeLessThan(0)
  })
})

describe('valueDeal', () => {
  it('values the fictional Tokyo example at ≈8.37¢ with a 25% bonus', () => {
    const ctx = evalCtx({ promotions: [promo({ bonusPercent: 25 })] })
    const v = valueDeal(flightDeal(), ctx)
    expect(v.calculable).toBe(true)
    expect(v.chasePoints).toBe(60_000)
    expect(v.headlineCpp).toBeCloseTo(8.3667, 3)
    expect(v.transfer?.bonusPercent).toBe(25)
    expect(v.confidence).toBe('high')
  })

  it('applies a demo deal’s illustrative bonus only to demo deals', () => {
    const demo = valueDeal(flightDeal({ sourceKind: 'demo', assumedBonusPercent: 25 }), evalCtx())
    expect(demo.chasePoints).toBe(60_000)
    expect(demo.flags.some((f) => f.code === 'illustrative_bonus')).toBe(true)
    const real = valueDeal(flightDeal({ sourceKind: 'manual', assumedBonusPercent: 25 }), evalCtx())
    expect(real.chasePoints).toBe(75_000)
  })

  it('refuses to calculate when taxes are unknown', () => {
    const v = valueDeal(flightDeal({ mandatoryCashUsd: null }), evalCtx())
    expect(v.calculable).toBe(false)
    expect(v.headlineCpp).toBeNull()
    expect(v.reasons.join(' ')).toMatch(/Taxes/)
  })

  it('refuses to compare a standard-room award against an overwater villa cash rate', () => {
    const deal = hotelDeal({
      hotel: { ...hotelDeal().hotel!, roomType: 'standard', roomCategory: 'Garden room' },
      cashProduct: { property: 'Test Resort Maldives', roomType: 'overwater_villa', checkIn: '2026-12-02', checkOut: '2026-12-06' },
    })
    const v = valueDeal(deal, evalCtx())
    expect(v.calculable).toBe(false)
    expect(v.reasons.join(' ')).toMatch(/a standard room but the cash rate is for an overwater villa/)
  })

  it('refuses to compare a recliner award against a lie-flat cash fare', () => {
    const deal = flightDeal({
      flight: { ...flightDeal().flight!, seatType: 'recliner' },
      cashProduct: { cabin: 'business', seatType: 'lie_flat', origin: 'LAX', destination: 'HND', date: '2026-12-01' },
    })
    expect(valueDeal(deal, evalCtx()).calculable).toBe(false)
  })

  it('refuses to compare different cabins', () => {
    const deal = flightDeal({ cashProduct: { cabin: 'first', origin: 'LAX', destination: 'HND', date: '2026-12-01' } })
    expect(valueDeal(deal, evalCtx()).calculable).toBe(false)
  })

  it('flags inflated cash prices against peers and lowers practical CPP', () => {
    const v = valueDeal(flightDeal({ comparableCashUsd: 12_000 }), { ...evalCtx(), peerCashPrices: [4_000, 4_500, 5_000] })
    expect(v.flags.some((f) => f.code === 'inflated_vs_peers')).toBe(true)
    expect(v.practicalCpp!).toBeLessThan(v.headlineCpp!)
    expect(v.practicalCashUsd).toBe(4_500)
  })

  it('uses a realistic alternative price for practical CPP', () => {
    const v = valueDeal(flightDeal({ alternativeCashUsd: 3_180 }), evalCtx())
    expect(v.headlineCpp).toBeCloseTo(((5200 - 180) / 75000) * 100, 6)
    expect(v.practicalCpp).toBeCloseTo(((3180 - 180) / 75000) * 100, 6)
  })

  it('flags rack-rate comparisons and lowers confidence', () => {
    const v = valueDeal(flightDeal({ comparableCashSource: 'rack_rate' }), evalCtx())
    expect(v.flags.some((f) => f.code === 'weak_cash_source')).toBe(true)
    expect(v.confidence).toBe('medium')
  })

  it('flags redemptions below the owner’s floor', () => {
    const v = valueDeal(flightDeal({ comparableCashUsd: 600 }), evalCtx({ pointFloorCents: 1.25 }))
    expect(v.flags.some((f) => f.code === 'below_floor')).toBe(true)
  })

  it('uses card-specific ratios (4:3 Hyatt-style override)', () => {
    const hotel = hotelDeal({ programPoints: 30_000 })
    const reserve = valueDeal(hotel, evalCtx({ card: 'sapphire_reserve' }))
    const preferred = valueDeal(hotel, evalCtx({ card: 'sapphire_preferred' }))
    expect(reserve.chasePoints).toBe(30_000)
    expect(preferred.chasePoints).toBe(40_000)
  })

  it('reports unknown programs instead of guessing', () => {
    const v = valueDeal(flightDeal({ programId: 'nope' }), evalCtx({ partners: partnersMap(partner()) }))
    expect(v.calculable).toBe(false)
    expect(v.reasons[0]).toMatch(/Unknown points program/)
  })

  it('values Chase Travel bookings without a transfer', () => {
    const v = valueDeal(flightDeal({ programId: 'chase_travel', programPoints: 300_000, comparableCashUsd: 3_000, mandatoryCashUsd: 0 }), evalCtx())
    expect(v.chasePoints).toBe(300_000)
    expect(v.headlineCpp).toBeCloseTo(1.0, 10)
  })
})
