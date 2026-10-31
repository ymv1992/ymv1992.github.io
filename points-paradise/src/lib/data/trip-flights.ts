import { and, eq } from 'drizzle-orm'
import type { AppDb } from '../db/client'
import { trips, tripItems, type FlightSchedule } from '../db/schema'
import { findScheduledFlight } from '../providers/serpapi'
import { lookupError, serpApiGate } from './cash-prices'
import { tripDayDate } from './trips'
import { logJob } from './usage'

export type FlightLookupResult = { ok: true; schedule: FlightSchedule } | { ok: false; error: string }

/**
 * Looks up a trip flight's times and aircraft in Google Flights (one SerpApi
 * search) and keeps them with the item. Fills the departure time when it
 * was empty; the owner's own times and aircraft are never overwritten.
 */
export async function lookUpTripFlight(
  db: AppDb,
  userId: string,
  itemId: string,
  deps: { apiKey: string; now: Date; fetch: typeof fetch; monthlyCapUsd: number },
): Promise<FlightLookupResult> {
  const [row] = await db
    .select({ item: tripItems, trip: trips })
    .from(tripItems)
    .innerJoin(trips, eq(trips.id, tripItems.tripId))
    .where(and(eq(tripItems.id, itemId), eq(trips.userId, userId)))
  if (!row) return { ok: false, error: 'Not found' }
  const { item, trip } = row
  const b = item.booking
  if (item.kind !== 'flight' || !b?.flightNumber || !b.from || !b.to) return { ok: false, error: 'Add the flight number and both airports first (Edit → Booking details).' }
  const date = item.day != null ? tripDayDate(trip, item.day) : null
  if (!date) return { ok: false, error: 'Put the flight on a day of a trip with dates first.' }
  if (date < deps.now.toISOString().slice(0, 10)) return { ok: false, error: 'Google Flights only lists upcoming flights.' }

  const params = { itemId, flightNumber: b.flightNumber, from: b.from, to: b.to, date }
  const gate = await serpApiGate(db, { provider: 'serpapi_flights', jobType: 'flight_details', params, now: deps.now, monthlyCapUsd: deps.monthlyCapUsd })
  if (!gate.ok) return { ok: false, error: gate.reason }
  const startedAt = new Date()
  try {
    const found = await findScheduledFlight(deps.apiKey, { from: b.from, to: b.to, date, flightNumber: b.flightNumber }, deps.fetch)
    await logJob(db, { provider: 'serpapi_flights', jobType: 'flight_details', params, status: 'succeeded', startedAt, requestCount: 1, estimatedCostUsd: gate.costUsd, resultsCount: found ? 1 : 0 })
    if (!found) return { ok: false, error: `Google Flights doesn't list ${b.flightNumber} from ${b.from} to ${b.to} on that day. Check the flight number and airports.` }
    const schedule: FlightSchedule = { date, from: b.from, to: b.to, ...found, flightNumber: b.flightNumber, checkedAt: deps.now.toISOString() }
    await db
      .update(tripItems)
      .set({ booking: { ...b, schedule }, ...(item.time ? {} : { time: found.departTime }), updatedAt: deps.now })
      .where(eq(tripItems.id, itemId))
    return { ok: true, schedule }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Flight lookup failed'
    await logJob(db, { provider: 'serpapi_flights', jobType: 'flight_details', params, status: 'failed', startedAt, requestCount: 1, error: message })
    return { ok: false, error: lookupError(message).replace('cash-price lookup', 'flight lookup') }
  }
}
