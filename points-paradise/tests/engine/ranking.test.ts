import { describe, expect, it } from 'vitest'
import { evaluateDeal } from '@/lib/engine/evaluate'
import { rankDeals, unrankable } from '@/lib/engine/ranking'
import { NOW, evalCtx, flightDeal, hotelDeal } from '../fixtures'

const ctx = evalCtx()
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000)

describe('rankDeals', () => {
  const verifiedLow = evaluateDeal(flightDeal({ id: 'verified-low', comparableCashUsd: 3_000 }), ctx)
  const verifiedHigh = evaluateDeal(flightDeal({ id: 'verified-high', comparableCashUsd: 6_000 }), ctx)
  const leadHuge = evaluateDeal(flightDeal({ id: 'lead-huge', comparableCashUsd: 9_000, lastVerifiedAt: null }), ctx)
  const cached = evaluateDeal(flightDeal({ id: 'cached', comparableCashUsd: 8_000, lastVerifiedAt: hoursAgo(200) }), ctx)
  const expired = evaluateDeal(flightDeal({ id: 'expired', travelStart: '2026-09-01' }), ctx)
  const unavailable = evaluateDeal(flightDeal({ id: 'gone', availability: 'unavailable' }), ctx)
  const demo = evaluateDeal(flightDeal({ id: 'demo', sourceKind: 'demo', comparableCashUsd: 20_000 }), ctx)
  const noTaxes = evaluateDeal(flightDeal({ id: 'no-taxes', mandatoryCashUsd: null }), ctx)
  const all = [leadHuge, verifiedLow, cached, expired, unavailable, demo, verifiedHigh, noTaxes]

  it('never ranks unverified, cached, expired or unavailable deals above verified ones', () => {
    const ranked = rankDeals(all, {}, { now: NOW })
    expect(ranked.map((r) => r.item.deal.id)).toEqual(['verified-high', 'verified-low', 'cached', 'lead-huge'])
    expect(ranked[0]!.tier).toBe(0)
    expect(ranked[2]!.tier).toBe(1)
    expect(ranked[3]!.tier).toBe(2)
  })

  it('excludes demo data unless explicitly included, and then ranks it last', () => {
    const ranked = rankDeals(all, { includeDemo: true }, { now: NOW })
    expect(ranked.at(-1)!.item.deal.id).toBe('demo')
    expect(ranked.at(-1)!.tier).toBe(3)
  })

  it('explains every ranking', () => {
    const [first] = rankDeals(all, {}, { now: NOW })
    expect(first!.explanation[0]).toMatch(/¢/)
    expect(first!.explanation.join(' ')).toMatch(/Verified/)
  })

  it('lists non-calculable deals separately', () => {
    const list = unrankable(all, false)
    expect(list.map((x) => x.item.deal.id)).toContain('no-taxes')
  })

  it('filters by max points, cabin, region and minimum CPP', () => {
    const ranked = rankDeals(all, { maxPoints: 70_000 }, { now: NOW })
    expect(ranked).toHaveLength(0)
    expect(rankDeals(all, { cabin: 'first' }, { now: NOW })).toHaveLength(0)
    expect(rankDeals(all, { region: 'europe' }, { now: NOW })).toHaveLength(0)
    expect(rankDeals(all, { minCpp: 7.5 }, { now: NOW }).map((r) => r.item.deal.id)).toEqual(['verified-high', 'cached', 'lead-huge'])
  })

  it('sorts by lowest points within tiers', () => {
    const cheap = evaluateDeal(flightDeal({ id: 'cheap', programPoints: 50_000 }), ctx)
    const pricey = evaluateDeal(flightDeal({ id: 'pricey', programPoints: 90_000 }), ctx)
    const ranked = rankDeals([pricey, cheap], {}, { now: NOW, sort: 'lowest_points' })
    expect(ranked.map((r) => r.item.deal.id)).toEqual(['cheap', 'pricey'])
  })

  it('filters saved vs unsaved', () => {
    const saved = new Set(['verified-low'])
    expect(rankDeals(all, { saved: 'saved', savedIds: saved }, { now: NOW }).map((r) => r.item.deal.id)).toEqual(['verified-low'])
  })

  it('supports positioning filters relative to home airports', () => {
    const fromSea = evaluateDeal(
      flightDeal({ id: 'sea', originAirport: 'SEA', cashProduct: { cabin: 'business', seatType: 'lie_flat', origin: 'SEA', destination: 'HND', date: '2026-12-01' } }),
      ctx,
    )
    const fromLax = evaluateDeal(flightDeal({ id: 'lax' }), ctx)
    const ranked = rankDeals([fromSea, fromLax], { positioningRequired: 'yes', homeAirports: ['LAX'] }, { now: NOW })
    expect(ranked.map((r) => r.item.deal.id)).toEqual(['sea'])
  })

  it('categorises hotels and budget fit', () => {
    const h = evaluateDeal(hotelDeal(), ctx)
    expect(h.categories).toContain('resorts')
    expect(h.categories).toContain('luxury-hotels')
    // 120,000 Chase points at 1:1 on a Sapphire Reserve.
    expect(h.categories).not.toContain('under-100k')
    expect(h.categories).toContain('within-budget')
    const tight = evaluateDeal(hotelDeal(), { ...ctx, pointsBalance: 100_000 })
    expect(tight.categories).not.toContain('within-budget')
  })
})
