import { describe, expect, it } from 'vitest'
import { parseTripRequest } from '@/lib/engine/trip-request'

describe('parseTripRequest', () => {
  it('parses the specification example', () => {
    const r = parseTripRequest('I have 150,000 Chase points and $1,000. Find me the most extraordinary vacation I can take in the next six months.')
    expect(r.points).toBe(150_000)
    expect(r.cashUsd).toBe(1_000)
    expect(r.months).toBe(6)
  })
  it('handles k suffixes, night ranges and travelers', () => {
    const r = parseTripRequest('120k points, $2k, 4-6 nights for two people within 3 months')
    expect(r.points).toBe(120_000)
    expect(r.cashUsd).toBe(2_000)
    expect([r.minNights, r.maxNights]).toEqual([4, 6])
    expect(r.travelers).toBe(2)
    expect(r.months).toBe(3)
  })
  it('understands weekend, honeymoon and leaves unknowns null', () => {
    const r = parseTripRequest('A honeymoon weekend somewhere warm')
    expect([r.minNights, r.maxNights]).toEqual([2, 3])
    expect(r.travelers).toBe(2)
    expect(r.points).toBeNull()
    expect(r.cashUsd).toBeNull()
  })
})
