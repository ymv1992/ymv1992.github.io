import { eq } from 'drizzle-orm'
import type { AppDb } from '../db/client'
import { dataSources, deals } from '../db/schema'
import type { Deal } from '../domain/types'
import { canSpend, withinQuota } from '../engine/budget'
import { searchFlightPrice, searchHotelRate } from '../providers/serpapi'
import { logJob, monthSpendUsd, monthStart, requestsSince } from './usage'

export type CashLookupResult =
  | { status: 'priced'; cashUsd: number }
  | { status: 'not_found'; reason: string }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string }

/** A deal that was looked up recently, priced or not, is not looked up again for this long. */
export const RECHECK_DAYS = 7

/** SerpApi requests this month (flights and hotels share the plan) and the monthly limit the app keeps to. */
export async function serpApiMonthUse(db: AppDb, now: Date): Promise<{ used: number; quota: number }> {
  const [flights] = await db.select().from(dataSources).where(eq(dataSources.id, 'serpapi_flights'))
  const used = (await requestsSince(db, 'serpapi_flights', monthStart(now))) + (await requestsSince(db, 'serpapi_hotels', monthStart(now)))
  return { used, quota: flights?.monthlyQuota ?? 100 }
}

/**
 * Looks up a comparable cash price for one deal through SerpApi (Google
 * Flights or Google Hotels), within the monthly quota and paid-request cap.
 * A lookup that finds no matching fare is remembered so it is not repeated
 * for RECHECK_DAYS.
 */
export async function lookupCashPrice(
  db: AppDb,
  deal: Deal,
  deps: { apiKey: string; now: Date; fetch: typeof fetch; monthlyCapUsd: number; jobType: string },
): Promise<CashLookupResult> {
  const { now } = deps
  const isHotel = deal.kind === 'hotel'
  const provider = isHotel ? 'serpapi_hotels' : 'serpapi_flights'
  const canFlight = !isHotel && deal.flight && deal.originAirport && deal.destination.airport && deal.travelStart
  const canHotel = isHotel && deal.hotel && deal.travelStart && deal.travelEnd
  if (!canFlight && !canHotel) return { status: 'skipped', reason: 'This deal is missing the route, property or dates needed for a cash lookup.' }

  const { used, quota } = await serpApiMonthUse(db, now)
  if (!withinQuota(used, 1, quota)) {
    await logJob(db, { provider, jobType: deps.jobType, params: { dealId: deal.id }, status: 'skipped_quota', startedAt: now, error: 'Monthly quota reached' })
    return { status: 'skipped', reason: `This month's ${quota} free cash-price lookups are used up. They reset on the 1st.` }
  }
  const [src] = await db.select().from(dataSources).where(eq(dataSources.id, provider))
  const cost = src?.costPerRequestUsd ?? 0
  const spent = (await monthSpendUsd(db, now)) - (await monthSpendUsd(db, now, 'anthropic'))
  const decision = canSpend(spent, cost, deps.monthlyCapUsd)
  if (!decision.allowed) {
    await logJob(db, { provider, jobType: deps.jobType, params: { dealId: deal.id }, status: 'skipped_budget', startedAt: now, error: decision.reason })
    return { status: 'skipped', reason: decision.reason }
  }

  const startedAt = new Date()
  try {
    let found: { priceUsd: number; cashProduct: Deal['cashProduct'] } | null = null
    if (canFlight) {
      const q = await searchFlightPrice(
        deps.apiKey,
        { from: deal.originAirport!, to: deal.destination.airport!, date: deal.travelStart!, cabin: deal.flight!.cabin, maxStops: deal.flight!.stops },
        deps.fetch,
      )
      if (q) found = { priceUsd: q.priceUsd, cashProduct: q.cashProduct }
    } else {
      const r = await searchHotelRate(deps.apiKey, { property: deal.hotel!.property, checkIn: deal.travelStart!, checkOut: deal.travelEnd!, adults: deal.hotel!.guests ?? 2 }, deps.fetch)
      if (r) found = { priceUsd: r.totalUsd, cashProduct: r.cashProduct }
    }
    await db
      .update(deals)
      .set(
        found
          ? {
              comparableCashUsd: found.priceUsd,
              comparableCashSource: 'live_api',
              comparableCashObservedAt: now,
              cashProduct: found.cashProduct,
              missingInfo: deal.missingInfo.filter((m) => m !== 'Comparable cash price'),
              updatedAt: now,
            }
          : // Remember the attempt so the same lookup is not repeated every run.
            { comparableCashObservedAt: now, updatedAt: now },
      )
      .where(eq(deals.id, deal.id))
    await logJob(db, { provider, jobType: deps.jobType, params: { dealId: deal.id }, status: 'succeeded', startedAt, requestCount: 1, estimatedCostUsd: cost, resultsCount: found ? 1 : 0 })
    return found
      ? { status: 'priced', cashUsd: found.priceUsd }
      : { status: 'not_found', reason: isHotel ? 'Google Hotels had no matching rate for these dates.' : 'Google Flights had no matching fare in this cabin for that date.' }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Cash lookup failed'
    await logJob(db, { provider, jobType: deps.jobType, params: { dealId: deal.id }, status: 'failed', startedAt, requestCount: 1, error: message })
    return { status: 'failed', reason: message }
  }
}
