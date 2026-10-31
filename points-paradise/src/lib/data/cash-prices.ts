import { eq } from 'drizzle-orm'
import type { AppDb } from '../db/client'
import { dataSources, deals } from '../db/schema'
import { CABIN_LABELS } from '../domain/constants'
import type { Deal } from '../domain/types'
import { dateLabel } from '../format'
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
 * Checks that one more SerpApi search fits this month's free searches and the
 * paid-request cap, and records a skipped search when it doesn't.
 */
export async function serpApiGate(
  db: AppDb,
  p: { provider: 'serpapi_flights' | 'serpapi_hotels'; jobType: string; params: Record<string, unknown>; now: Date; monthlyCapUsd: number; searches?: number },
): Promise<{ ok: true; costUsd: number } | { ok: false; reason: string }> {
  const n = p.searches ?? 1
  const { used, quota } = await serpApiMonthUse(db, p.now)
  if (!withinQuota(used, n, quota)) {
    await logJob(db, { provider: p.provider, jobType: p.jobType, params: p.params, status: 'skipped_quota', startedAt: p.now, error: 'Monthly quota reached' })
    return { ok: false, reason: `This month's ${quota} free Google searches are used up (${used} used). They reset on the 1st.` }
  }
  const [src] = await db.select().from(dataSources).where(eq(dataSources.id, p.provider))
  const cost = src?.costPerRequestUsd ?? 0
  const spent = (await monthSpendUsd(db, p.now)) - (await monthSpendUsd(db, p.now, 'anthropic'))
  const decision = canSpend(spent, cost * n, p.monthlyCapUsd)
  if (!decision.allowed) {
    await logJob(db, { provider: p.provider, jobType: p.jobType, params: p.params, status: 'skipped_budget', startedAt: p.now, error: decision.reason })
    return { ok: false, reason: decision.reason }
  }
  return { ok: true, costUsd: cost }
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

  const gate = await serpApiGate(db, { provider, jobType: deps.jobType, params: { dealId: deal.id }, now, monthlyCapUsd: deps.monthlyCapUsd })
  if (!gate.ok) return { status: 'skipped', reason: gate.reason }
  const cost = gate.costUsd

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
    if (found) return { status: 'priced', cashUsd: found.priceUsd }
    return {
      status: 'not_found',
      reason: isHotel
        ? `Google Hotels had no rate for ${deal.hotel!.property} on these dates.`
        : `Google Flights had no ${CABIN_LABELS[deal.flight!.cabin].toLowerCase()} fare from ${deal.originAirport} to ${deal.destination.airport} on ${dateLabel(deal.travelStart)}.`,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Cash lookup failed'
    await logJob(db, { provider, jobType: deps.jobType, params: { dealId: deal.id }, status: 'failed', startedAt, requestCount: 1, error: message })
    return { status: 'failed', reason: lookupError(message) }
  }
}

/** Plain-language reason for a failed lookup; the full error stays in Settings → Usage. */
export function lookupError(message: string): string {
  if (/timeout|timed out|aborted/i.test(message)) return 'Google took too long to answer. Try again in a minute.'
  if (/\b(401|403)\b|invalid api key/i.test(message)) return 'SerpApi did not accept the key. Check SERPAPI_API_KEY in Vercel.'
  if (/\b429\b|run out of searches/i.test(message)) return 'SerpApi says the plan is out of searches or busy. Try again later.'
  return 'The cash-price lookup failed. Details are in Settings → Usage.'
}
