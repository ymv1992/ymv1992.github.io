import type { EvaluatedDeal } from './evaluate'
import { checkBudget, type BudgetCheck, type TripBudget } from './budget'
import { isBookableStatus } from './status'

export type TripRole = 'outbound' | 'return' | 'hotel' | 'package'
export type PayWith = 'points' | 'cash'

export interface TripComponent {
  role: TripRole
  item: EvaluatedDeal
  payWith: PayWith
  chasePoints: number
  cashUsd: number
  comparableUsd: number | null
}

export type TripStatus = 'bookable' | 'hypothetical' | 'incomplete' | 'demo'

export interface TripPlan {
  id: string
  destination: string
  countryCode: string | null
  components: TripComponent[]
  startDate: string | null
  endDate: string | null
  nights: number | null
  usesPositioning: boolean
  strategy: string
  totals: {
    chasePoints: number
    cashUsd: number
    comparableUsd: number
    foodUsd: number
    totalOutOfPocketUsd: number
  }
  effectiveCpp: number | null
  status: TripStatus
  missing: string[]
  budget: BudgetCheck
  matchScore: number
}

export interface TripRequest {
  budget: TripBudget
  homeAirports: readonly string[]
  windowStart: string
  windowEnd: string
  minNights: number
  maxNights: number
  travelers: number
  foodPerPersonPerDayUsd: number
  allowPositioning: boolean
  includeDemo: boolean
  maxPlans?: number
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function nightsBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

function usable(e: EvaluatedDeal, includeDemo: boolean): boolean {
  if (e.status === 'expired' || e.status === 'unavailable' || e.status === 'prediction') return false
  if (e.status === 'demo' && !includeDemo) return false
  return true
}

function destKey(e: EvaluatedDeal): string {
  return `${e.deal.destination.city.toLowerCase()}|${(e.deal.destination.countryCode ?? e.deal.destination.country).toLowerCase()}`
}

function payOptions(e: EvaluatedDeal): { payWith: PayWith; chasePoints: number; cashUsd: number }[] {
  const out: { payWith: PayWith; chasePoints: number; cashUsd: number }[] = []
  const v = e.valuation
  if (v.chasePoints != null && v.chasePoints > 0 && e.deal.mandatoryCashUsd != null) {
    out.push({ payWith: 'points', chasePoints: v.chasePoints, cashUsd: e.deal.mandatoryCashUsd })
  }
  if (e.deal.comparableCashUsd != null) out.push({ payWith: 'cash', chasePoints: 0, cashUsd: e.deal.comparableCashUsd })
  return out
}

function describeStrategy(components: readonly TripComponent[]): string {
  const flights = components.filter((c) => c.role === 'outbound' || c.role === 'return')
  const hotels = components.filter((c) => c.role === 'hotel')
  const pkg = components.find((c) => c.role === 'package')
  if (pkg) return pkg.payWith === 'points' ? 'Package booked with points' : 'Package paid in cash'
  const f = flights.length === 0 ? null : flights.every((c) => c.payWith === 'points') ? 'points' : flights.every((c) => c.payWith === 'cash') ? 'cash' : 'mixed'
  const h = hotels[0]?.payWith ?? null
  const parts: string[] = []
  if (f) parts.push(f === 'mixed' ? 'Mixed points/cash for flights' : `${f === 'points' ? 'Points' : 'Cash'} for flights`)
  if (h) parts.push(`${h === 'points' ? 'points' : 'cash'} for hotel`)
  return parts.join(' + ') || 'Single component'
}

function buildPlan(components: TripComponent[], req: TripRequest, missing: string[]): TripPlan {
  const first = components[0]!.item.deal
  const outbound = components.find((c) => c.role === 'outbound' || c.role === 'package' || c.role === 'hotel')?.item.deal
  const ret = components.find((c) => c.role === 'return')?.item.deal
  const hotel = components.find((c) => c.role === 'hotel' || c.role === 'package')?.item.deal
  const startDate = outbound?.travelStart ?? null
  const endDate = ret?.travelStart ?? hotel?.travelEnd ?? (startDate && hotel?.nights ? addDays(startDate, hotel.nights) : null)
  const nights = startDate && endDate ? nightsBetween(startDate, endDate) : (hotel?.nights ?? null)
  const chasePoints = components.reduce((s, c) => s + c.chasePoints, 0)
  const cashUsd = components.reduce((s, c) => s + c.cashUsd, 0)
  const comparableUsd = components.reduce((s, c) => s + (c.comparableUsd ?? 0), 0)
  const foodUsd = nights != null ? Math.max(1, nights + 1) * req.foodPerPersonPerDayUsd * req.travelers : 0
  const pointsComponents = components.filter((c) => c.payWith === 'points')
  const valueRedeemed = pointsComponents.reduce((s, c) => s + ((c.comparableUsd ?? 0) - c.cashUsd), 0)
  const effectiveCpp =
    chasePoints > 0 && pointsComponents.every((c) => c.comparableUsd != null) ? (valueRedeemed / chasePoints) * 100 : null
  const statuses = components.map((c) => c.item.status)
  const status: TripStatus = statuses.includes('demo')
    ? 'demo'
    : missing.length > 0
      ? 'incomplete'
      : statuses.every(isBookableStatus)
        ? 'bookable'
        : 'hypothetical'
  const usesPositioning = components.some(
    (c) => c.role === 'outbound' && c.item.deal.originAirport != null && !req.homeAirports.includes(c.item.deal.originAirport),
  )
  return {
    id: components.map((c) => `${c.role}:${c.item.deal.id}:${c.payWith}`).join('|'),
    destination: `${first.destination.city}, ${first.destination.country}`,
    countryCode: first.destination.countryCode,
    components,
    startDate,
    endDate,
    nights,
    usesPositioning,
    strategy: describeStrategy(components),
    totals: { chasePoints, cashUsd, comparableUsd, foodUsd, totalOutOfPocketUsd: cashUsd + foodUsd },
    effectiveCpp,
    status,
    missing,
    budget: checkBudget({ chasePoints, cashUsd }, req.budget),
    matchScore: Math.round(components.reduce((s, c) => s + c.item.match.score, 0) / components.length),
  }
}

/**
 * Assembles candidate trips from known flights and hotels and compares
 * points/cash mixes within the owner's budget. Only data already in the
 * database is used; missing pieces are reported, never invented.
 */
export function buildTrips(items: readonly EvaluatedDeal[], req: TripRequest): { plans: TripPlan[]; overBudget: number } {
  const pool = items.filter(
    (e) =>
      usable(e, req.includeDemo) &&
      e.deal.travelStart != null &&
      e.deal.travelStart >= req.windowStart &&
      e.deal.travelStart <= req.windowEnd &&
      !e.match.excluded,
  )
  const byDest = new Map<string, EvaluatedDeal[]>()
  for (const e of pool) {
    const k = destKey(e)
    const list = byDest.get(k) ?? []
    list.push(e)
    byDest.set(k, list)
  }
  const flightsByOrigin = new Map<string, EvaluatedDeal[]>()
  for (const e of items) {
    if (!usable(e, req.includeDemo) || e.deal.kind !== 'flight' || !e.deal.originAirport) continue
    const list = flightsByOrigin.get(e.deal.originAirport) ?? []
    list.push(e)
    flightsByOrigin.set(e.deal.originAirport, list)
  }

  const plans: TripPlan[] = []
  for (const group of byDest.values()) {
    const outbounds = group
      .filter((e) => e.deal.kind === 'flight' && e.deal.originAirport != null)
      .filter((e) => req.allowPositioning || req.homeAirports.includes(e.deal.originAirport!))
    const hotels = group.filter((e) => e.deal.kind === 'hotel')
    const packages = group.filter((e) => e.deal.kind === 'package')

    for (const pkg of packages) {
      for (const opt of payOptions(pkg)) {
        plans.push(
          buildPlan([{ role: 'package', item: pkg, ...opt, comparableUsd: pkg.deal.comparableCashUsd }], req, []),
        )
      }
    }

    const outboundOptions = outbounds.length > 0 ? outbounds : [null]
    for (const out of outboundOptions) {
      const arrival = out?.deal.travelStart ?? null
      const destAirport = out?.deal.destination.airport ?? null
      const returns = out && destAirport
        ? (flightsByOrigin.get(destAirport) ?? [])
            .filter((r) => r.deal.travelStart != null && arrival != null && r.deal.travelStart > arrival)
            .filter((r) => r.deal.destination.airport != null && (req.homeAirports.includes(r.deal.destination.airport) || r.deal.destination.airport === out.deal.originAirport))
            .filter((r) => {
              const n = nightsBetween(arrival!, r.deal.travelStart!)
              return n >= req.minNights && n <= req.maxNights
            })
            .slice(0, 3)
        : []
      const matchingHotels = hotels
        .filter((h) => {
          if (!arrival) return true
          const n = nightsBetween(arrival, h.deal.travelStart!)
          return n >= 0 && n <= 1 && (h.deal.nights ?? 0) >= req.minNights - 1 && (h.deal.nights ?? 0) <= req.maxNights
        })
        .slice(0, 3)

      if (!out && matchingHotels.length === 0) continue
      const returnOptions: (EvaluatedDeal | null)[] = returns.length ? returns : [null]
      const hotelOptions: (EvaluatedDeal | null)[] = matchingHotels.length ? matchingHotels : [null]
      for (const ret of returnOptions) {
        for (const hotel of hotelOptions) {
          const parts: { role: TripRole; item: EvaluatedDeal }[] = []
          if (out) parts.push({ role: 'outbound', item: out })
          if (ret) parts.push({ role: 'return', item: ret })
          if (hotel) parts.push({ role: 'hotel', item: hotel })
          const missing: string[] = []
          if (!out) missing.push('No outbound flight found in your data for these dates')
          if (out && !ret) missing.push('No return flight found in your data — add one or search for it')
          if (!hotel) missing.push('No hotel found in your data for these dates')
          // Enumerate pay-with combinations (at most 2^3 = 8).
          let combos: TripComponent[][] = [[]]
          for (const p of parts) {
            const opts = payOptions(p.item)
            if (opts.length === 0) {
              missing.push(`${p.item.deal.title}: no usable price`)
              continue
            }
            combos = combos.flatMap((c) => opts.map((o) => [...c, { role: p.role, item: p.item, ...o, comparableUsd: p.item.deal.comparableCashUsd }]))
          }
          for (const combo of combos) {
            if (combo.length === 0) continue
            plans.push(buildPlan(combo, req, missing))
          }
        }
      }
    }
  }

  // Complete trips first, then real before demo, then evidence strength, then value.
  const statusOrder: Record<TripStatus, number> = { bookable: 0, hypothetical: 1, incomplete: 2, demo: 3 }
  const within = plans.filter((p) => p.budget.ok)
  const sorted = within.sort(
    (a, b) =>
      Number(a.missing.length > 0) - Number(b.missing.length > 0) ||
      Number(a.status === 'demo') - Number(b.status === 'demo') ||
      statusOrder[a.status] - statusOrder[b.status] ||
      (b.effectiveCpp ?? -1) - (a.effectiveCpp ?? -1) ||
      b.matchScore - a.matchScore ||
      a.totals.cashUsd - b.totals.cashUsd,
  )
  // Keep the best two strategies per destination so the list shows variety.
  const perDest = new Map<string, number>()
  const out: TripPlan[] = []
  for (const p of sorted) {
    const n = perDest.get(p.destination) ?? 0
    if (n >= 2) continue
    perDest.set(p.destination, n + 1)
    out.push(p)
    if (out.length >= (req.maxPlans ?? 12)) break
  }
  return { plans: out, overBudget: plans.length - within.length }
}
