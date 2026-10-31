/** Showing award results: cabin comparisons, seat counts, bonus notes and calendar links (TEST FIXTURES). */
import { describe, expect, it } from 'vitest'
import type { AwardSearchResultRow, CabinCompareRow } from '@/lib/data/award-search'
import { remainingSeats, type SeatsAeroItem } from '@/lib/providers/seats-aero'
import { bonusNotes, cabinsIn, lowestByCabin, seatsLabel, upgradeNote } from '@/lib/search/compare'
import { parseCalendarSelection } from '@/lib/view/calendar-selection'

const opt = (points: number, extra: Partial<AwardSearchResultRow> = {}): AwardSearchResultRow => ({
  dealId: `d${points}`,
  cabin: 'economy',
  origin: 'LAX',
  airport: 'CUN',
  city: 'Cancún',
  country: 'Mexico',
  date: '2026-11-05',
  points,
  taxesUsd: 56,
  airline: 'UA',
  programId: 'united',
  direct: true,
  seats: null,
  chasePoints: points,
  cashUsd: null,
  cpp: null,
  cashLookupTried: false,
  bonus: null,
  ...extra,
})

describe('cabin comparison', () => {
  it('says how much more a better cabin costs than economy', () => {
    expect(upgradeNote({ economy: opt(20000), business: opt(27500) })).toBe('Business is only 7,500 more points than Economy.')
    expect(upgradeNote({ economy: opt(20000), business: opt(60000) })).toBe('Business is 40,000 more points than Economy (3.0×).')
    expect(upgradeNote({ economy: opt(20000), premium_economy: opt(20000) })).toBe('Premium economy costs no more points than Economy here.')
    // Business is compared before first and premium economy.
    expect(upgradeNote({ economy: opt(10000), premium_economy: opt(12000), business: opt(14000), first: opt(30000) })).toMatch(/^Business/)
    expect(upgradeNote({ business: opt(30000) })).toBeNull()
    expect(upgradeNote({ economy: opt(30000) })).toBeNull()
  })

  it('uses Chase points (with any bonus) when comparing', () => {
    expect(upgradeNote({ economy: opt(20000), business: opt(35000, { chasePoints: 27000 }) })).toBe('Business is only 7,000 more points than Economy.')
  })

  it('finds the cabins present and the lowest price in each', () => {
    const rows: CabinCompareRow[] = [
      { key: 'a', origin: 'LAX', airport: 'CUN', city: 'Cancún', country: 'Mexico', when: '2026-11-05', cells: { economy: opt(15000), business: opt(40000) } },
      { key: 'b', origin: 'LAX', airport: 'CUN', city: 'Cancún', country: 'Mexico', when: '2026-11-06', cells: { economy: opt(12000), first: opt(90000) } },
    ]
    expect(cabinsIn(rows)).toEqual(['economy', 'business', 'first'])
    expect(lowestByCabin(rows)).toEqual({ economy: 12000, business: 40000, first: 90000 })
  })
})

describe('seats', () => {
  it('reads seats left, treating 0 as not reported', () => {
    const item = { YRemainingSeats: 2, JRemainingSeats: 0 } as SeatsAeroItem
    expect(remainingSeats(item, 'economy')).toBe(2)
    expect(remainingSeats(item, 'business')).toBeNull()
    expect(remainingSeats(item, 'first')).toBeNull()
  })

  it('labels the count, and reminds to check when it is unknown and more than one seat is needed', () => {
    expect(seatsLabel(1, 1)).toBe('1 seat left')
    expect(seatsLabel(4, 2)).toBe('4 seats left')
    expect(seatsLabel(null, 1)).toBeNull()
    expect(seatsLabel(null, 2)).toBe('seats not reported — check before transferring')
  })
})

describe('transfer bonus notes', () => {
  it('explain each bonus once, with its end date and how sure it is', () => {
    const bonus = { percent: 30, partnerName: 'Air Canada', endsAt: '2026-11-16T04:59:00.000Z', endsAtTimezone: 'America/New_York', verification: 'reported' as const, sourceUrl: null, chasePointsWithout: 60000 }
    const notes = bonusNotes([opt(60000, { bonus }), opt(50000, { bonus }), opt(40000)])
    expect(notes).toHaveLength(1)
    // 11:59 PM Eastern on Nov 15 is already Nov 16 in UTC; the note keeps the Eastern date.
    expect(notes[0]!.text).toBe(
      'Chase is adding 30% when you transfer to Air Canada until Nov 15, 2026 (reported — confirm it in your Chase account before transferring). Chase points shown for Air Canada awards already include it.',
    )
  })
})

describe('calendar selection', () => {
  it('reads the route and cabin, including older links with the cabin in the route', () => {
    expect(parseCalendarSelection({ key: 'f:LAX:CUN', cabin: 'business' })).toEqual({ key: 'f:LAX:CUN', cabin: 'business' })
    expect(parseCalendarSelection({ key: 'f:LAX:CUN:premium_economy' })).toEqual({ key: 'f:LAX:CUN', cabin: 'premium_economy' })
    expect(parseCalendarSelection({ key: 'f:LAX:CUN:first', cabin: 'economy' })).toEqual({ key: 'f:LAX:CUN', cabin: 'economy' })
    expect(parseCalendarSelection({ key: 'h:Park Hyatt Tokyo', cabin: 'nope' })).toEqual({ key: 'h:Park Hyatt Tokyo', cabin: undefined })
    expect(parseCalendarSelection({})).toEqual({ key: undefined, cabin: undefined })
  })
})
