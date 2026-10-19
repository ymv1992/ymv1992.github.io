/**
 * Compares departing from a home airport against positioning to another
 * airport for a cheaper or better award. All inputs are explicit so the
 * owner can see exactly which costs drive the recommendation.
 */

export interface PositioningLeg {
  cashUsd: number
  chasePoints: number
  groundUsd: number
  baggageUsd: number
  hotelUsd: number
  mealsUsd: number
  extraMinutes: number
  airportChange: boolean
  separateTicket: boolean
  overnight: boolean
  international: boolean
}

export interface DepartureOption {
  label: string
  departureAirport: string
  awardChasePoints: number
  awardCashUsd: number
  mainTravelMinutes: number
  /** Null when departing from home. */
  positioning: PositioningLeg | null
}

export interface OptionTotals {
  label: string
  departureAirport: string
  chasePoints: number
  cashUsd: number
  travelMinutes: number
  /** Cash plus points valued at the owner's floor value. */
  equivalentCostUsd: number
}

export interface PositioningComparison {
  home: OptionTotals
  alternative: OptionTotals
  savingsUsd: number
  pointsSaved: number
  cashDifferenceUsd: number
  extraMinutes: number
  recommend: 'alternative' | 'home'
  reasons: string[]
  risks: string[]
  recommendedBufferMinutes: number | null
}

export function optionTotals(o: DepartureOption, pointValueCents: number): OptionTotals {
  const p = o.positioning
  const chasePoints = o.awardChasePoints + (p?.chasePoints ?? 0)
  const cashUsd = o.awardCashUsd + (p ? p.cashUsd + p.groundUsd + p.baggageUsd + p.hotelUsd + p.mealsUsd : 0)
  const travelMinutes = o.mainTravelMinutes + (p?.extraMinutes ?? 0)
  return {
    label: o.label,
    departureAirport: o.departureAirport,
    chasePoints,
    cashUsd,
    travelMinutes,
    equivalentCostUsd: cashUsd + (chasePoints * pointValueCents) / 100,
  }
}

/**
 * Minimum connection buffer when the positioning flight is on a separate
 * ticket. Airlines are not obliged to protect a missed connection across
 * independently booked tickets, so these are deliberately conservative.
 */
export function recommendedBufferMinutes(leg: Pick<PositioningLeg, 'separateTicket' | 'international' | 'airportChange' | 'overnight'>, checkedBags: boolean): number | null {
  if (!leg.separateTicket) return null
  if (leg.overnight) return 0
  let buffer = leg.international ? 300 : 180
  if (checkedBags) buffer += 60
  if (leg.airportChange) buffer += 120
  return buffer
}

export interface CompareOptions {
  pointValueCents: number
  /** Extra travel time you accept per $100 saved. */
  minutesPer100Usd?: number
  checkedBags?: boolean
  minSavingsUsd?: number
}

export function comparePositioning(home: DepartureOption, alt: DepartureOption, opts: CompareOptions): PositioningComparison {
  const h = optionTotals(home, opts.pointValueCents)
  const a = optionTotals(alt, opts.pointValueCents)
  const savings = h.equivalentCostUsd - a.equivalentCostUsd
  const extra = a.travelMinutes - h.travelMinutes
  const minSavings = Math.max(opts.minSavingsUsd ?? 100, h.equivalentCostUsd * 0.1)
  const minutesPer100 = opts.minutesPer100Usd ?? 60
  const reasons: string[] = []
  const risks: string[] = []
  const p = alt.positioning

  if (p?.separateTicket) {
    risks.push(
      'The positioning flight is a separate ticket. If it is delayed or cancelled, the award airline has no obligation to rebook you or protect your connection.',
    )
  }
  if (p?.airportChange) risks.push('Requires changing airports, which adds ground time and risk.')
  if (p?.international) risks.push('Positioning crosses a border — check passport, visa and transit rules for every country involved.')
  if (p?.overnight) reasons.push('Includes an overnight stay before the award flight, which reduces missed-connection risk.')

  let recommend: PositioningComparison['recommend'] = 'home'
  if (savings < minSavings) {
    reasons.push(`Saves only $${Math.round(savings).toLocaleString('en-US')} in equivalent value (threshold $${Math.round(minSavings).toLocaleString('en-US')}).`)
  } else if (extra > 0 && extra > (savings / 100) * minutesPer100) {
    reasons.push(
      `Saves $${Math.round(savings).toLocaleString('en-US')} but adds ${Math.round(extra / 60)} h of travel — more than the ${minutesPer100} min per $100 you accept.`,
    )
  } else {
    recommend = 'alternative'
    reasons.push(`Saves about $${Math.round(savings).toLocaleString('en-US')} in equivalent value after all positioning costs.`)
  }

  return {
    home: h,
    alternative: a,
    savingsUsd: savings,
    pointsSaved: h.chasePoints - a.chasePoints,
    cashDifferenceUsd: a.cashUsd - h.cashUsd,
    extraMinutes: extra,
    recommend,
    reasons,
    risks,
    recommendedBufferMinutes: p ? recommendedBufferMinutes(p, opts.checkedBags ?? false) : null,
  }
}
