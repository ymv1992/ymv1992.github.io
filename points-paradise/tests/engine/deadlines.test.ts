import { describe, expect, it } from 'vitest'
import { describeDeadline, dueReminders, formatCountdown } from '@/lib/engine/deadlines'
import { computeStatus, expiryReason, isStale } from '@/lib/engine/status'
import { NOW, flightDeal } from '../fixtures'

const inHours = (h: number) => new Date(NOW.getTime() + h * 3_600_000)

describe('describeDeadline', () => {
  it('gives a countdown only for confirmed deadlines', () => {
    const d = describeDeadline(flightDeal({ deadline: { at: inHours(50), type: 'confirmed', source: 'Chase promotion page', timezone: 'America/New_York' } }), NOW)
    expect(d.type).toBe('confirmed')
    expect(d.countdownMs).toBe(50 * 3_600_000)
    expect(d.headline).toMatch(/Book by/)
    expect(d.confidence).toBe('high')
  })

  it('never invents a date for observed availability', () => {
    const d = describeDeadline(flightDeal({ deadline: { at: null, type: 'observed', source: null, timezone: null } }), NOW)
    expect(d.at).toBeNull()
    expect(d.countdownMs).toBeNull()
    expect(d.headline).toBe('Available at last check')
  })

  it('never invents a date for estimated urgency', () => {
    const d = describeDeadline(flightDeal({ deadline: { at: inHours(10), type: 'estimated', source: '12 past observations', timezone: null } }), NOW)
    expect(d.at).toBeNull()
    expect(d.countdownMs).toBeNull()
    expect(d.confidence).toBe('low')
  })

  it('formats countdowns', () => {
    expect(formatCountdown(50 * 3_600_000)).toBe('2d 2h')
    expect(formatCountdown(90 * 60_000)).toBe('1h 30m')
    expect(formatCountdown(5 * 60_000)).toBe('5m')
    expect(formatCountdown(-1)).toBe('Ended')
  })
})

describe('dueReminders', () => {
  it('sends nothing more than 7 days out', () => {
    expect(dueReminders(inHours(24 * 8), NOW, new Set())).toEqual({ send: null, skip: [] })
  })
  it('sends the 7-day reminder in its window', () => {
    expect(dueReminders(inHours(24 * 6), NOW, new Set())).toEqual({ send: '7d', skip: [] })
  })
  it('collapses missed reminders into the most recent one', () => {
    expect(dueReminders(inHours(5), NOW, new Set())).toEqual({ send: '6h', skip: ['7d', '3d', '24h'] })
  })
  it('does not resend reminders already handled', () => {
    expect(dueReminders(inHours(5), NOW, new Set(['7d', '3d', '24h', '6h']))).toEqual({ send: null, skip: [] })
  })
  it('respects enabled offsets', () => {
    expect(dueReminders(inHours(5), NOW, new Set(), ['24h'])).toEqual({ send: '24h', skip: [] })
  })
  it('stops after the deadline passes', () => {
    expect(dueReminders(inHours(-1), NOW, new Set())).toEqual({ send: null, skip: [] })
  })
})

describe('status and expiration', () => {
  it('expires on a confirmed deadline', () => {
    const d = flightDeal({ deadline: { at: inHours(-1), type: 'confirmed', source: 'x', timezone: null } })
    expect(expiryReason(d, NOW)).toBe('deadline_passed')
    expect(computeStatus(d, NOW)).toBe('expired')
  })
  it('expires after the travel date', () => {
    expect(expiryReason(flightDeal({ travelStart: '2026-10-10' }), NOW)).toBe('travel_date_passed')
    expect(expiryReason(flightDeal({ travelStart: '2026-10-18' }), NOW)).toBeNull()
  })
  it('uses the end of a flexible window', () => {
    expect(expiryReason(flightDeal({ travelStart: '2026-10-01', travelEnd: '2026-11-30', flexibleDates: true }), NOW)).toBeNull()
  })
  it('classifies freshness', () => {
    expect(computeStatus(flightDeal({ lastVerifiedAt: inHours(-2) }), NOW)).toBe('verified_live')
    expect(computeStatus(flightDeal({ lastVerifiedAt: inHours(-30) }), NOW)).toBe('recently_verified')
    expect(computeStatus(flightDeal({ lastVerifiedAt: inHours(-100) }), NOW)).toBe('cached')
    expect(computeStatus(flightDeal({ lastVerifiedAt: null }), NOW)).toBe('unverified_lead')
    expect(computeStatus(flightDeal({ sourceKind: 'research' }), NOW)).toBe('unverified_lead')
    expect(computeStatus(flightDeal({ sourceKind: 'demo', travelStart: '2020-01-01' }), NOW)).toBe('demo')
  })
  it('detects stale data', () => {
    expect(isStale(null, NOW, 24)).toBe(true)
    expect(isStale(inHours(-10), NOW, 24)).toBe(false)
    expect(isStale(inHours(-49), NOW, 24)).toBe(true)
    expect(isStale(inHours(-80), NOW, 168)).toBe(true)
  })
})
