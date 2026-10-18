import { describe, expect, it } from 'vitest'
import { canSpend, checkBudget, withinQuota } from '@/lib/engine/budget'
import { comparePositioning, recommendedBufferMinutes, type DepartureOption } from '@/lib/engine/positioning'
import { evaluateDeal } from '@/lib/engine/evaluate'
import { buildTrips, type TripRequest } from '@/lib/engine/trip'
import { evalCtx, flightDeal, hotelDeal } from '../fixtures'

describe('budget limits', () => {
  it('checks points and cash budgets', () => {
    expect(checkBudget({ chasePoints: 120_000, cashUsd: 900 }, { pointsBalance: 150_000, maxCashUsd: 1_000 })).toMatchObject({
      ok: true,
      pointsRemaining: 30_000,
      cashRemainingUsd: 100,
    })
    expect(checkBudget({ chasePoints: 160_000, cashUsd: 1_200 }, { pointsBalance: 150_000, maxCashUsd: 1_000 })).toMatchObject({
      ok: false,
      pointsShortfall: 10_000,
      cashOverageUsd: 200,
    })
  })

  it('pauses paid requests before exceeding the monthly cap', () => {
    expect(canSpend(9.2, 0.5, 10).allowed).toBe(false)
    expect(canSpend(5, 0.5, 10).allowed).toBe(true)
    expect(canSpend(0, 0.01, 0).allowed).toBe(false)
    expect(canSpend(100, 0, 0).allowed).toBe(true)
  })

  it('enforces provider quotas', () => {
    expect(withinQuota(999, 1, 1000)).toBe(true)
    expect(withinQuota(1000, 1, 1000)).toBe(false)
    expect(withinQuota(5, 1, null)).toBe(true)
  })
})

describe('positioning optimizer', () => {
  const home: DepartureOption = {
    label: 'From LAX',
    departureAirport: 'LAX',
    awardChasePoints: 110_000,
    awardCashUsd: 200,
    mainTravelMinutes: 12 * 60,
    positioning: null,
  }
  const alt: DepartureOption = {
    label: 'Position to SEA',
    departureAirport: 'SEA',
    awardChasePoints: 70_000,
    awardCashUsd: 150,
    mainTravelMinutes: 11 * 60,
    positioning: {
      cashUsd: 120,
      chasePoints: 0,
      groundUsd: 40,
      baggageUsd: 0,
      hotelUsd: 0,
      mealsUsd: 20,
      extraMinutes: 3 * 60,
      airportChange: false,
      separateTicket: true,
      overnight: false,
      international: false,
    },
  }

  it('recommends positioning when total savings justify the costs', () => {
    const c = comparePositioning(home, alt, { pointValueCents: 1.25 })
    expect(c.extraMinutes).toBe(120)
    // Home: 200 + 110,000 × 1.25¢ = $1,575. Alt: 150+120+40+20 = $330 + 70,000 × 1.25¢ = $1,205.
    expect(c.home.equivalentCostUsd).toBeCloseTo(1575)
    expect(c.alternative.equivalentCostUsd).toBeCloseTo(1205)
    expect(c.savingsUsd).toBeCloseTo(370)
    expect(c.pointsSaved).toBe(40_000)
    expect(c.recommend).toBe('alternative')
    expect(c.risks.join(' ')).toMatch(/separate ticket/)
  })

  it('stays home when savings are small', () => {
    const c = comparePositioning(home, { ...alt, awardChasePoints: 105_000 }, { pointValueCents: 1.25 })
    expect(c.recommend).toBe('home')
  })

  it('stays home when the extra travel time is not worth it', () => {
    const slow = { ...alt, positioning: { ...alt.positioning!, extraMinutes: 30 * 60 } }
    expect(comparePositioning(home, slow, { pointValueCents: 1.25, minutesPer100Usd: 60 }).recommend).toBe('home')
  })

  it('recommends conservative buffers for separate tickets', () => {
    expect(recommendedBufferMinutes({ separateTicket: false, international: false, airportChange: false, overnight: false }, false)).toBeNull()
    expect(recommendedBufferMinutes({ separateTicket: true, international: false, airportChange: false, overnight: false }, false)).toBe(180)
    expect(recommendedBufferMinutes({ separateTicket: true, international: true, airportChange: true, overnight: false }, true)).toBe(480)
  })
})

describe('trip architect', () => {
  const ctx = evalCtx()
  const out = evaluateDeal(flightDeal({ id: 'out', destination: { ...hotelDeal().destination }, programPoints: 50_000, mandatoryCashUsd: 100, comparableCashUsd: 3_000, cashProduct: null, travelStart: '2026-12-01' }), ctx)
  const ret = evaluateDeal(
    flightDeal({
      id: 'ret',
      originAirport: 'MLE',
      destination: { city: 'Los Angeles', country: 'United States', countryCode: 'US', region: 'north_america', airport: 'LAX', lat: 33.9, lon: -118.4 },
      programPoints: 50_000,
      mandatoryCashUsd: 100,
      comparableCashUsd: 3_000,
      cashProduct: null,
      travelStart: '2026-12-06',
    }),
    ctx,
  )
  const hotel = evaluateDeal(hotelDeal({ id: 'hotel', travelStart: '2026-12-01', travelEnd: '2026-12-06', nights: 5, programPoints: 40_000, mandatoryCashUsd: 200, comparableCashUsd: 5_000, cashProduct: null }), ctx)
  const req: TripRequest = {
    budget: { pointsBalance: 150_000, maxCashUsd: 1_000 },
    homeAirports: ['LAX'],
    windowStart: '2026-10-18',
    windowEnd: '2027-04-18',
    minNights: 3,
    maxNights: 10,
    travelers: 1,
    foodPerPersonPerDayUsd: 50,
    allowPositioning: false,
    includeDemo: false,
  }

  it('assembles a complete trip within budget and computes effective CPP', () => {
    const { plans } = buildTrips([out, ret, hotel], req)
    const allPoints = plans.find((p) => p.components.length === 3 && p.components.every((c) => c.payWith === 'points'))
    expect(allPoints).toBeDefined()
    expect(allPoints!.totals.chasePoints).toBe(140_000)
    expect(allPoints!.totals.cashUsd).toBe(400)
    expect(allPoints!.effectiveCpp).toBeCloseTo(((3000 - 100) * 2 + (5000 - 200)) / 140_000 * 100, 6)
    expect(allPoints!.missing).toEqual([])
    expect(allPoints!.status).toBe('bookable')
    expect(allPoints!.nights).toBe(5)
    expect(allPoints!.totals.foodUsd).toBe(300)
  })

  it('respects the points budget', () => {
    const { plans, overBudget } = buildTrips([out, ret, hotel], { ...req, budget: { pointsBalance: 60_000, maxCashUsd: 1_000 } })
    expect(plans.every((p) => p.totals.chasePoints <= 60_000 && p.totals.cashUsd <= 1_000)).toBe(true)
    expect(overBudget).toBeGreaterThan(0)
  })

  it('labels trips with missing components as incomplete', () => {
    const { plans } = buildTrips([out, hotel], req)
    expect(plans.length).toBeGreaterThan(0)
    expect(plans.every((p) => p.status === 'incomplete')).toBe(true)
    expect(plans[0]!.missing.join(' ')).toMatch(/return flight/)
  })

  it('labels trips with unverified components as hypothetical', () => {
    const lead = evaluateDeal(hotelDeal({ id: 'lead-hotel', lastVerifiedAt: null, travelStart: '2026-12-01', travelEnd: '2026-12-06', nights: 5, cashProduct: null, programPoints: 40_000 }), ctx)
    const { plans } = buildTrips([out, ret, lead], req)
    const full = plans.find((p) => p.components.length === 3)
    expect(full?.status).toBe('hypothetical')
  })
})

describe('trip ordering', () => {
  it('lists complete trips before incomplete ones', () => {
    const ctx = evalCtx()
    const outA = evaluateDeal(flightDeal({ id: 'a-out', programPoints: 20_000, comparableCashUsd: 9_000, cashProduct: null, travelStart: '2026-12-01' }), ctx)
    const out = evaluateDeal(flightDeal({ id: 'out2', destination: { ...hotelDeal().destination }, programPoints: 50_000, mandatoryCashUsd: 100, comparableCashUsd: 3_000, cashProduct: null, travelStart: '2026-12-01' }), ctx)
    const ret = evaluateDeal(
      flightDeal({
        id: 'ret2',
        originAirport: 'MLE',
        destination: { city: 'Los Angeles', country: 'United States', countryCode: 'US', region: 'north_america', airport: 'LAX', lat: 33.9, lon: -118.4 },
        programPoints: 50_000,
        mandatoryCashUsd: 100,
        comparableCashUsd: 3_000,
        cashProduct: null,
        travelStart: '2026-12-06',
      }),
      ctx,
    )
    const hotel = evaluateDeal(hotelDeal({ id: 'hotel2', travelStart: '2026-12-01', travelEnd: '2026-12-06', nights: 5, programPoints: 40_000, mandatoryCashUsd: 200, comparableCashUsd: 5_000, cashProduct: null }), ctx)
    const { plans } = buildTrips([outA, out, ret, hotel], {
      budget: { pointsBalance: 150_000, maxCashUsd: 1_000 },
      homeAirports: ['LAX'],
      windowStart: '2026-10-18',
      windowEnd: '2027-04-18',
      minNights: 3,
      maxNights: 10,
      travelers: 1,
      foodPerPersonPerDayUsd: 50,
      allowPositioning: false,
      includeDemo: false,
    })
    // The Tokyo one-way has a far higher CPP but is incomplete, so it must come after the complete trip.
    expect(plans[0]!.missing).toEqual([])
    expect(plans.findIndex((p) => p.destination.startsWith('Tokyo'))).toBeGreaterThan(0)
  })
})
