import { CABIN_LABELS, ROOM_TYPE_LABELS, ROOM_TYPE_RANK, SEAT_TYPE_LABELS, SEAT_TYPE_RANK } from '../domain/constants'
import type { Deal } from '../domain/types'

export type ComparabilitySeverity = 'major' | 'minor' | 'missing'

export interface ComparabilityIssue {
  severity: ComparabilitySeverity
  code: string
  message: string
}

export interface ComparabilityResult {
  /** False when the cash price describes a materially different product. */
  comparable: boolean
  issues: ComparabilityIssue[]
}

function daysBetween(a: string, b: string): number {
  const da = Date.parse(`${a}T00:00:00Z`)
  const db = Date.parse(`${b}T00:00:00Z`)
  if (Number.isNaN(da) || Number.isNaN(db)) return 0
  return Math.round(Math.abs(da - db) / 86_400_000)
}

/** "an overwater villa", "a standard room". */
function withArticle(label: string): string {
  const l = label.toLowerCase()
  return `${/^[aeiou]/.test(l) ? 'an' : 'a'} ${l}`
}

function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * Checks that the comparable cash price describes substantially the same
 * product as the award. A major mismatch means CPP must not be calculated.
 */
export function checkComparability(deal: Pick<Deal, 'kind' | 'flight' | 'hotel' | 'cashProduct' | 'originAirport' | 'destination' | 'travelStart' | 'travelEnd'>): ComparabilityResult {
  const issues: ComparabilityIssue[] = []
  const cash = deal.cashProduct

  if (deal.kind === 'flight' && deal.flight) {
    const f = deal.flight
    if (!cash) {
      issues.push({ severity: 'missing', code: 'cash_product_missing', message: 'The cash fare has no cabin/route details, so equivalence is unconfirmed.' })
    } else {
      if (cash.cabin && cash.cabin !== f.cabin) {
        issues.push({
          severity: 'major',
          code: 'cabin_mismatch',
          message: `Award is ${CABIN_LABELS[f.cabin]} but the cash fare is ${CABIN_LABELS[cash.cabin]}.`,
        })
      } else if (!cash.cabin) {
        issues.push({ severity: 'missing', code: 'cash_cabin_missing', message: 'Cash fare cabin not recorded.' })
      }
      const awardSeat = SEAT_TYPE_RANK[f.seatType]
      const cashSeat = cash.seatType ? SEAT_TYPE_RANK[cash.seatType] : -1
      if (awardSeat >= 0 && cashSeat >= 0 && cashSeat > awardSeat) {
        issues.push({
          severity: 'major',
          code: 'seat_mismatch',
          message: `Award seat is ${withArticle(SEAT_TYPE_LABELS[f.seatType])} but the cash fare is for ${withArticle(SEAT_TYPE_LABELS[cash.seatType!])}.`,
        })
      } else if (f.seatType === 'unknown' && (f.cabin === 'business' || f.cabin === 'first')) {
        issues.push({ severity: 'minor', code: 'seat_unverified', message: 'Seat type (lie-flat vs recliner) is not verified.' })
      }
      if (cash.origin && deal.originAirport && cash.origin !== deal.originAirport) {
        issues.push({ severity: 'major', code: 'origin_mismatch', message: `Cash fare departs ${cash.origin}, award departs ${deal.originAirport}.` })
      }
      if (cash.destination && deal.destination.airport && cash.destination !== deal.destination.airport) {
        issues.push({
          severity: 'major',
          code: 'destination_mismatch',
          message: `Cash fare arrives ${cash.destination}, award arrives ${deal.destination.airport}.`,
        })
      }
      if (cash.date && deal.travelStart) {
        const d = daysBetween(cash.date, deal.travelStart)
        if (d > 3) issues.push({ severity: 'major', code: 'date_mismatch', message: `Cash fare is ${d} days away from the award date.` })
        else if (d > 0) issues.push({ severity: 'minor', code: 'date_nearby', message: `Cash fare is from a nearby date (${d} day${d === 1 ? '' : 's'} apart).` })
      }
      if (cash.stops != null && f.stops != null && cash.stops < f.stops) {
        issues.push({
          severity: 'minor',
          code: 'fewer_stops_in_cash',
          message: `Cash fare has fewer stops (${cash.stops}) than the award (${f.stops}).`,
        })
      }
      if (cash.mixedCabin && !f.mixedCabin) {
        issues.push({
          severity: 'minor',
          code: 'mixed_cabin_cash',
          message: 'The cash fare has a shorter flight in a lower cabin, so it is a little cheaper and the value may be understated.',
        })
      }
      if (cash.refundable === true) {
        issues.push({ severity: 'minor', code: 'refundable_cash', message: 'Cash comparison is a refundable fare, which usually costs more than the cheapest fare.' })
      }
    }
    if (f.mixedCabin) {
      issues.push({ severity: 'minor', code: 'mixed_cabin', message: 'Itinerary includes segments in a lower cabin.' })
    }
  }

  if (deal.kind === 'hotel' && deal.hotel) {
    const h = deal.hotel
    if (!cash) {
      issues.push({ severity: 'missing', code: 'cash_product_missing', message: 'The cash rate has no property/room details, so equivalence is unconfirmed.' })
    } else {
      if (cash.property && norm(cash.property) !== norm(h.property)) {
        issues.push({ severity: 'major', code: 'property_mismatch', message: `Cash rate is for ${cash.property}, not ${h.property}.` })
      }
      const awardRoom = ROOM_TYPE_RANK[h.roomType]
      const cashRoom = cash.roomType ? ROOM_TYPE_RANK[cash.roomType] : -1
      if (awardRoom >= 0 && cashRoom >= 0 && cashRoom > awardRoom) {
        issues.push({
          severity: 'major',
          code: 'room_mismatch',
          message: `Award is ${withArticle(ROOM_TYPE_LABELS[h.roomType])} but the cash rate is for ${withArticle(ROOM_TYPE_LABELS[cash.roomType!])}.`,
        })
      } else if (h.roomType === 'unknown' || cashRoom < 0) {
        issues.push({ severity: 'minor', code: 'room_unverified', message: 'Room category equivalence is not verified.' })
      }
      if (cash.checkIn && deal.travelStart && cash.checkIn !== deal.travelStart) {
        issues.push({ severity: 'major', code: 'checkin_mismatch', message: 'Cash rate is for different check-in date.' })
      }
      if (cash.checkOut && deal.travelEnd && cash.checkOut !== deal.travelEnd) {
        issues.push({ severity: 'major', code: 'checkout_mismatch', message: 'Cash rate is for different check-out date.' })
      }
      if (cash.guests != null && h.guests != null && cash.guests !== h.guests) {
        issues.push({ severity: 'minor', code: 'guest_mismatch', message: `Cash rate is for ${cash.guests} guests, award for ${h.guests}.` })
      }
      if (cash.mealsIncluded === true && !h.meals) {
        issues.push({ severity: 'minor', code: 'meals_in_cash', message: 'Cash rate includes meals that the award does not.' })
      }
    }
  }

  return { comparable: !issues.some((i) => i.severity === 'major'), issues }
}
