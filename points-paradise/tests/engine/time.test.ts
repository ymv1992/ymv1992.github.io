import { describe, expect, it } from 'vitest'
import { zonedWallTimeToDate } from '@/lib/time'

describe('zonedWallTimeToDate', () => {
  it('interprets wall time in the given zone, including DST', () => {
    // 11:59 PM Eastern Daylight Time = 03:59 UTC next day.
    expect(zonedWallTimeToDate('2026-10-15T23:59', 'America/New_York')?.toISOString()).toBe('2026-10-16T03:59:00.000Z')
    // Standard time in winter: UTC−5.
    expect(zonedWallTimeToDate('2026-12-15T12:00', 'America/New_York')?.toISOString()).toBe('2026-12-15T17:00:00.000Z')
    expect(zonedWallTimeToDate('2026-07-01T09:30', 'Asia/Tokyo')?.toISOString()).toBe('2026-07-01T00:30:00.000Z')
    expect(zonedWallTimeToDate('2026-07-01T09:30', 'UTC')?.toISOString()).toBe('2026-07-01T09:30:00.000Z')
  })
  it('rejects bad input', () => {
    expect(zonedWallTimeToDate('yesterday', 'UTC')).toBeNull()
    expect(zonedWallTimeToDate('2026-07-01T09:30', 'Mars/Olympus')).toBeNull()
  })
})

import { toZonedLocalInput } from '@/lib/time'

describe('toZonedLocalInput', () => {
  it('round-trips with zonedWallTimeToDate', () => {
    const d = zonedWallTimeToDate('2026-10-15T23:59', 'America/New_York')!
    expect(toZonedLocalInput(d, 'America/New_York')).toBe('2026-10-15T23:59')
    expect(toZonedLocalInput(d, 'UTC')).toBe('2026-10-16T03:59')
  })
})
