import { describe, expect, it } from 'vitest'
import { decideAlert, isInQuietHours, notificationKey, type AlertPreferences } from '@/lib/engine/notify'
import { planBatch, priorityScore, type QueueCandidate } from '@/lib/engine/priority'
import { detectPriceChange, predict, type Observation } from '@/lib/engine/history'
import { learnFromFeedback, personalMatch } from '@/lib/engine/personalization'
import { NOW, flightDeal, hotelDeal, neutralProfile } from '../fixtures'

const prefs: AlertPreferences = {
  enabledTypes: ['new_exceptional_deal', 'saved_price_drop', 'deadline_reminder'],
  minCpp: 3,
  maxPoints: 150_000,
  maxCashUsd: 1_000,
  destinations: [],
  cabins: [],
  hotelCategories: [],
  travelFrom: null,
  travelTo: null,
  urgentOnly: false,
  frequency: 'instant',
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
  timeZone: 'America/Los_Angeles',
}

describe('notification deduplication', () => {
  it('builds stable keys so the same event is stored once', () => {
    const a = notificationKey({ type: 'saved_price_drop', dealId: 'd1', discriminator: 'points=60000' })
    const b = notificationKey({ type: 'saved_price_drop', dealId: 'd1', discriminator: 'points=60000' })
    const c = notificationKey({ type: 'saved_price_drop', dealId: 'd1', discriminator: 'points=55000' })
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(notificationKey({ type: 'transfer_bonus_new', promotionId: 'p1', discriminator: '30' })).toBe('transfer_bonus_new|promo:p1|30')
  })
})

describe('alert decisions', () => {
  // 12:00Z = 05:00 in Los Angeles (PDT), inside 22:00–07:00 quiet hours.
  it('handles quiet hours that wrap midnight', () => {
    expect(isInQuietHours(NOW, '22:00', '07:00', 'America/Los_Angeles')).toBe(true)
    expect(isInQuietHours(new Date('2026-10-18T20:00:00Z'), '22:00', '07:00', 'America/Los_Angeles')).toBe(false)
    expect(isInQuietHours(NOW, '09:00', '17:00', 'America/Los_Angeles')).toBe(false)
    expect(isInQuietHours(NOW, null, null, 'UTC')).toBe(false)
  })
  it('defers during quiet hours and sends otherwise', () => {
    const e = { type: 'new_exceptional_deal' as const, dealId: 'd', discriminator: 'x', cpp: 5, chasePoints: 60_000, cashUsd: 100 }
    expect(decideAlert(e, prefs, NOW).action).toBe('defer')
    expect(decideAlert(e, prefs, new Date('2026-10-18T20:00:00Z')).action).toBe('send')
  })
  it('applies value criteria', () => {
    const later = new Date('2026-10-18T20:00:00Z')
    expect(decideAlert({ type: 'new_exceptional_deal', discriminator: 'x', cpp: 2 }, prefs, later).action).toBe('suppress')
    expect(decideAlert({ type: 'new_exceptional_deal', discriminator: 'x', cpp: 4, chasePoints: 200_000 }, prefs, later).action).toBe('suppress')
    expect(decideAlert({ type: 'availability_observed', discriminator: 'x', cpp: 9 }, prefs, later).action).toBe('suppress')
  })
  it('lets deadline reminders bypass value filters', () => {
    expect(decideAlert({ type: 'deadline_reminder', discriminator: '24h', cpp: 0.5 }, prefs, new Date('2026-10-18T20:00:00Z')).action).toBe('send')
  })
  it('batches into a daily digest when requested', () => {
    expect(decideAlert({ type: 'new_exceptional_deal', discriminator: 'x', cpp: 5 }, { ...prefs, frequency: 'daily' }, NOW).action).toBe('digest')
  })
})

describe('search priority queue', () => {
  const base: QueueCandidate = {
    key: 'k',
    kind: 'watchlist',
    provider: 'seats_aero',
    lastCheckedAt: new Date(NOW.getTime() - 48 * 3_600_000),
    refreshHours: 24,
    unchangedStreak: 0,
    estimatedCostUsd: 0,
  }
  it('prioritises user requests and urgent deadlines', () => {
    const user = { ...base, key: 'u', kind: 'user_request' as const }
    const low = { ...base, key: 'l', kind: 'low_interest' as const }
    const deadline = { ...base, key: 'd', kind: 'deadline' as const, hoursToDeadline: 6 }
    expect(priorityScore(user, NOW)).toBeGreaterThan(priorityScore(deadline, NOW))
    expect(priorityScore(deadline, NOW)).toBeGreaterThan(priorityScore(low, NOW))
  })
  it('backs off unchanged results', () => {
    const fresh = { ...base, lastCheckedAt: new Date(NOW.getTime() - 30 * 3_600_000) }
    const plan = planBatch([{ ...fresh, key: 'a' }, { ...fresh, key: 'b', unchangedStreak: 4 }], NOW, { maxRequests: 10, budgetRemainingUsd: 1 })
    expect(plan.selected.map((c) => c.key)).toEqual(['a'])
    expect(plan.notDue.map((c) => c.key)).toEqual(['b'])
  })
  it('stays within request, cost and provider budgets and removes duplicates', () => {
    const cands: QueueCandidate[] = [
      { ...base, key: 'a', estimatedCostUsd: 0.4 },
      { ...base, key: 'a', estimatedCostUsd: 0.4 },
      { ...base, key: 'b', estimatedCostUsd: 0.4 },
      { ...base, key: 'c', estimatedCostUsd: 0.4, provider: 'serpapi' },
    ]
    const plan = planBatch(cands, NOW, { maxRequests: 5, budgetRemainingUsd: 0.8 })
    expect(plan.selected).toHaveLength(2)
    expect(plan.skippedBudget).toHaveLength(1)
    const quota = planBatch(cands, NOW, { maxRequests: 5, budgetRemainingUsd: 10, perProviderRemaining: { seats_aero: 1 } })
    expect(quota.selected.map((c) => c.provider).sort()).toEqual(['seats_aero', 'serpapi'])
  })
})

describe('price history and predictions', () => {
  const obs = (daysAgo: number, points: number | null, availability: Observation['availability'] = 'available'): Observation => ({
    observedAt: new Date(NOW.getTime() - daysAgo * 86_400_000),
    programPoints: points,
    cashUsd: null,
    mandatoryCashUsd: 100,
    availability,
  })
  it('detects significant drops and newly appearing space', () => {
    expect(detectPriceChange(obs(1, 80_000), obs(0, 70_000)).significant).toBe(true)
    expect(detectPriceChange(obs(1, 80_000), obs(0, 79_000)).significant).toBe(false)
    expect(detectPriceChange(obs(1, 80_000), obs(0, 90_000)).kind).toBe('rise')
    expect(detectPriceChange(obs(1, null, 'unavailable'), obs(0, 70_000)).availabilityChange).toBe('appeared')
  })
  it('refuses to predict with insufficient history', () => {
    const p = predict([obs(3, 70_000), obs(1, 75_000)], 70_000)
    expect(p.reliable).toBe(false)
    if (!p.reliable) expect(p.reason).toMatch(/No reliable prediction/)
  })
  it('predicts with enough history and explains the evidence', () => {
    const history = Array.from({ length: 30 }, (_, i) => obs(60 - i * 2, i % 3 === 0 ? null : 80_000 + (i % 5) * 5_000, i % 3 === 0 ? 'unavailable' : 'available'))
    const p = predict(history, 70_000)
    expect(p.reliable).toBe(true)
    if (p.reliable) {
      expect(p.percentile).toBe(0)
      expect(p.explanation).toMatch(/not a guarantee/)
    }
  })
})

describe('personalization', () => {
  it('separates personal match from value and explains it', () => {
    const m = personalMatch(hotelDeal(), { ...neutralProfile, tagPreferences: { beach: 2, romantic: 1 }, dreamDestinations: ['Maldives'] })
    expect(m.score).toBeGreaterThan(80)
    expect(m.reasons.join(' ')).toMatch(/Dream destination/)
  })
  it('applies hard deal-breakers', () => {
    const deal = flightDeal({ flight: { ...flightDeal().flight!, stops: 1, durationMinutes: 15 * 60 } })
    const m = personalMatch(deal, { ...neutralProfile, dealBreakers: ['no_connections'], maxFlightHours: 12 })
    expect(m.excluded).toBe(true)
    expect(m.exclusions).toHaveLength(2)
  })
  it('learns in small clamped steps', () => {
    let w = {}
    for (let i = 0; i < 20; i++) w = learnFromFeedback(w, ['beach'], 'save')
    expect((w as Record<string, number>).beach).toBe(1)
    const after = learnFromFeedback({ snow: 0 }, ['snow'], 'pass')
    expect(after.snow).toBeCloseTo(-0.08)
    expect(learnFromFeedback({}, ['x'], 'rating', 5).x).toBeCloseTo(0.2)
  })
})
