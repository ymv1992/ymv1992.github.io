/**
 * Chase points earned on a cash flight: booked with the airline vs through
 * Chase Travel. Rates are what Chase publishes for each card (researched
 * October 2026; confirm in your Chase account, since offers change). Cards
 * whose flight rates couldn't be confirmed are marked so.
 */
import type { CardType } from './constants'

export interface FlightEarnRates {
  /** Points per dollar on a flight bought from the airline. */
  direct: number
  /** Points per dollar on a flight bought through Chase Travel. */
  chaseTravel: number
  /** Plain words for where the rates come from. */
  note: string
  confirmed: boolean
}

export const FLIGHT_EARN: Record<CardType, FlightEarnRates> = {
  sapphire_reserve: { direct: 4, chaseTravel: 8, note: '8× through Chase Travel, 4× on flights booked with the airline', confirmed: true },
  sapphire_reserve_business: { direct: 4, chaseTravel: 8, note: '8× through Chase Travel, 4× on flights booked with the airline', confirmed: true },
  sapphire_preferred: { direct: 2, chaseTravel: 5, note: '5× through Chase Travel, 2× on other travel', confirmed: true },
  ink_business_preferred: { direct: 3, chaseTravel: 3, note: '3× on travel (on the first $150,000 a year in its bonus categories)', confirmed: true },
  freedom_unlimited: { direct: 1.5, chaseTravel: 5, note: '5× through Chase Travel, 1.5× on everything else', confirmed: true },
  freedom_flex: { direct: 1, chaseTravel: 5, note: '5× through Chase Travel, 1× on everything else (more in some rotating quarters)', confirmed: true },
  ink_plus: { direct: 1, chaseTravel: 1, note: 'Legacy card: flight rates not confirmed, so 1× is assumed', confirmed: false },
  freedom: { direct: 1, chaseTravel: 1, note: 'Legacy card: flight rates not confirmed, so 1× is assumed', confirmed: false },
  ink_business_cash: { direct: 1, chaseTravel: 1, note: 'Flight rates not confirmed, so 1× is assumed', confirmed: false },
  ink_business_unlimited: { direct: 1.5, chaseTravel: 1.5, note: '1.5× on everything; a Chase Travel bonus is not confirmed', confirmed: false },
  other: { direct: 1, chaseTravel: 1, note: 'Card not set: 1× is assumed (choose your card in Settings)', confirmed: false },
}

export interface EarnComparison {
  directPoints: number
  chaseTravelPoints: number
  /** What the flight costs after counting the points earned at the owner's point value. */
  directNetUsd: number
  chaseTravelNetUsd: number
  /** Chase Travel is the better deal up to this price; above it, book with the airline. */
  breakEvenChasePriceUsd: number
}

/**
 * Compares booking with the airline at `priceUsd` against Chase Travel at
 * `chasePriceUsd` (the same price unless the owner saw a different one),
 * valuing each point at `pointCents`.
 */
export function compareEarning(priceUsd: number, rates: FlightEarnRates, pointCents: number, chasePriceUsd = priceUsd): EarnComparison {
  const v = pointCents / 100
  const directPoints = Math.floor(priceUsd * rates.direct)
  const chaseTravelPoints = Math.floor(chasePriceUsd * rates.chaseTravel)
  return {
    directPoints,
    chaseTravelPoints,
    directNetUsd: priceUsd - directPoints * v,
    chaseTravelNetUsd: chasePriceUsd - chaseTravelPoints * v,
    breakEvenChasePriceUsd: (priceUsd * (1 - rates.direct * v)) / (1 - rates.chaseTravel * v),
  }
}
