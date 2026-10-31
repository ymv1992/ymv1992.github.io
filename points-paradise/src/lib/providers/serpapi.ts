/**
 * SerpApi adapters for comparable cash prices (Google Flights / Google Hotels).
 * Every call counts against the owner's SerpApi plan quota, so callers gate
 * them through the budget and quota checks first.
 */
import { z } from 'zod'
import type { Cabin, SeatType } from '../domain/constants'
import type { CashProduct } from '../domain/types'

const BASE = 'https://serpapi.com/search.json'
const TRAVEL_CLASS: Record<Cabin, string> = { economy: '1', premium_economy: '2', business: '3', first: '4' }
const CLASS_LABEL: Record<Cabin, string> = { economy: 'economy', premium_economy: 'premium economy', business: 'business', first: 'first' }
const CLASS_RANK: Record<string, number> = { economy: 0, 'premium economy': 1, business: 2, first: 3 }
/** SerpApi reports a search that found nothing as an error; it is a normal "no fare" answer. */
const NO_RESULTS = /(hasn't|has not) returned any results/i

const airportTimeSchema = z.object({ id: z.string().optional(), name: z.string().optional(), time: z.string().optional() }).passthrough()

const segmentSchema = z
  .object({
    departure_airport: airportTimeSchema.optional(),
    arrival_airport: airportTimeSchema.optional(),
    airline: z.string().optional(),
    flight_number: z.string().optional(),
    airplane: z.string().optional(),
    travel_class: z.string().optional(),
    extensions: z.array(z.string()).optional(),
    duration: z.number().optional(),
  })
  .passthrough()

const itinerarySchema = z
  .object({
    flights: z.array(segmentSchema),
    layovers: z.array(z.object({ duration: z.number().optional() }).passthrough()).optional(),
    total_duration: z.number().optional(),
    price: z.number().optional(),
  })
  .passthrough()

const flightsResponseSchema = z
  .object({
    best_flights: z.array(itinerarySchema).optional(),
    other_flights: z.array(itinerarySchema).optional(),
    error: z.string().optional(),
  })
  .passthrough()

type Segment = z.infer<typeof segmentSchema>

export interface FlightQuote {
  priceUsd: number
  stops: number
  /** A shorter flight in the trip is in a lower cabin than the one searched. */
  mixedCabin: boolean
  durationMinutes: number | null
  airlines: string
  flightNumbers: string[]
  aircraft: string | null
  seatType: SeatType
  cashProduct: CashProduct
}

function seatFromExtensions(ext: string[]): SeatType {
  const text = ext.join(' ').toLowerCase()
  if (text.includes('suite')) return 'suite'
  if (text.includes('lie flat') || text.includes('lie-flat')) return 'lie_flat'
  if (text.includes('angled flat')) return 'angled_flat'
  return 'unknown'
}

/** The flight with the longest flying time, or null when Google left out durations. */
function longestSegment(flights: Segment[]): Segment | null {
  if (!flights.length || flights.some((f) => f.duration == null)) return null
  return flights.reduce((a, b) => (b.duration! > a.duration! ? b : a))
}

/**
 * Cheapest one-way fare in the requested cabin. Fares with every segment in
 * that cabin come first. Otherwise a connecting fare counts when its longest
 * flight is in the cabin and the shorter ones are in the same or a lower
 * cabin: Google sells many connections that way, and a lower cabin on the
 * short hop can only make the fare cheaper, so the value is never overstated.
 * Prefers itineraries with no more stops than the award when given.
 */
export async function searchFlightPrice(
  apiKey: string,
  p: { from: string; to: string; date: string; cabin: Cabin; maxStops?: number | null },
  fetchImpl: typeof fetch = fetch,
): Promise<FlightQuote | null> {
  const qs = new URLSearchParams({
    engine: 'google_flights',
    departure_id: p.from,
    arrival_id: p.to,
    outbound_date: p.date,
    type: '2',
    travel_class: TRAVEL_CLASS[p.cabin],
    adults: '1',
    currency: 'USD',
    hl: 'en',
    gl: 'us',
    api_key: apiKey,
  })
  const res = await fetchImpl(`${BASE}?${qs}`, { signal: AbortSignal.timeout(45_000) })
  if (!res.ok) throw new Error(`SerpApi responded ${res.status}`)
  const body = flightsResponseSchema.parse(await res.json())
  if (body.error) {
    if (NO_RESULTS.test(body.error)) return null
    throw new Error(`SerpApi: ${body.error}`)
  }
  const all = [...(body.best_flights ?? []), ...(body.other_flights ?? [])].filter((i) => i.price != null && i.price > 0)
  const label = CLASS_LABEL[p.cabin]
  const classOf = (f: Segment) => (f.travel_class ?? '').toLowerCase()
  const sameCabin = all.filter((i) => i.flights.every((f) => classOf(f) === label))
  const mainInCabin = all.filter((i) => {
    if (sameCabin.includes(i)) return false
    const main = longestSegment(i.flights)
    return main != null && classOf(main) === label && i.flights.every((f) => (CLASS_RANK[classOf(f)] ?? Infinity) <= CLASS_RANK[label]!)
  })
  const withinStops = (list: typeof all) => list.filter((i) => p.maxStops == null || i.flights.length - 1 <= p.maxStops)
  const pool = [withinStops(sameCabin), sameCabin, withinStops(mainInCabin), mainInCabin].find((l) => l.length) ?? []
  const best = [...pool].sort((a, b) => a.price! - b.price!)[0]
  if (!best) return null
  const mixedCabin = !sameCabin.includes(best)
  const ext = best.flights.flatMap((f) => f.extensions ?? [])
  const seat = seatFromExtensions(ext)
  return {
    priceUsd: best.price!,
    stops: best.flights.length - 1,
    mixedCabin,
    durationMinutes: best.total_duration ?? null,
    airlines: [...new Set(best.flights.map((f) => f.airline).filter(Boolean))].join(', '),
    flightNumbers: best.flights.map((f) => f.flight_number).filter((x): x is string => !!x),
    aircraft: best.flights.map((f) => f.airplane).filter(Boolean).join(' / ') || null,
    seatType: seat,
    cashProduct: { cabin: p.cabin, seatType: seat === 'unknown' ? null : seat, origin: p.from, destination: p.to, date: p.date, stops: best.flights.length - 1, refundable: false, mixedCabin },
  }
}

export interface ScheduledFlight {
  flightNumber: string
  airline: string | null
  departTime: string
  arriveTime: string
  arriveDayOffset: number
  durationMinutes: number | null
  aircraft: string | null
}

const flightKey = (v: string) => v.toUpperCase().replace(/\s+/g, '').replace(/^([A-Z0-9]{2})0+/, '$1')

/** "2026-11-05 08:05" → date and time. */
function splitTime(v: string | undefined): { date: string; time: string } | null {
  const m = v?.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})/)
  return m ? { date: m[1]!, time: `${m[2]!.padStart(2, '0')}:${m[3]}` } : null
}

/**
 * Finds one flight's schedule and aircraft in Google Flights: searches the
 * route on that date and picks the flight with that number between those
 * airports. Null when Google Flights doesn't list it (wrong number, airports
 * or date, or a flight that has already left).
 */
export async function findScheduledFlight(
  apiKey: string,
  p: { from: string; to: string; date: string; flightNumber: string },
  fetchImpl: typeof fetch = fetch,
): Promise<ScheduledFlight | null> {
  const qs = new URLSearchParams({
    engine: 'google_flights',
    departure_id: p.from,
    arrival_id: p.to,
    outbound_date: p.date,
    type: '2',
    adults: '1',
    currency: 'USD',
    hl: 'en',
    gl: 'us',
    api_key: apiKey,
  })
  const res = await fetchImpl(`${BASE}?${qs}`, { signal: AbortSignal.timeout(45_000) })
  if (!res.ok) throw new Error(`SerpApi responded ${res.status}`)
  const body = flightsResponseSchema.parse(await res.json())
  if (body.error) {
    if (NO_RESULTS.test(body.error)) return null
    throw new Error(`SerpApi: ${body.error}`)
  }
  const want = flightKey(p.flightNumber)
  for (const itinerary of [...(body.best_flights ?? []), ...(body.other_flights ?? [])]) {
    for (const f of itinerary.flights) {
      if (!f.flight_number || flightKey(f.flight_number) !== want) continue
      if (f.departure_airport?.id !== p.from || f.arrival_airport?.id !== p.to) continue
      const dep = splitTime(f.departure_airport?.time)
      const arr = splitTime(f.arrival_airport?.time)
      if (!dep || !arr || dep.date !== p.date) continue
      return {
        flightNumber: f.flight_number,
        airline: f.airline ?? null,
        departTime: dep.time,
        arriveTime: arr.time,
        arriveDayOffset: Math.max(0, Math.round((Date.parse(`${arr.date}T00:00:00Z`) - Date.parse(`${dep.date}T00:00:00Z`)) / 86_400_000)),
        durationMinutes: f.duration ?? null,
        aircraft: f.airplane?.trim() || null,
      }
    }
  }
  return null
}

const hotelsResponseSchema = z
  .object({
    properties: z
      .array(
        z
          .object({
            name: z.string(),
            total_rate: z.object({ extracted_lowest: z.number().optional() }).passthrough().optional(),
            rate_per_night: z.object({ extracted_lowest: z.number().optional() }).passthrough().optional(),
          })
          .passthrough(),
      )
      .optional(),
    error: z.string().optional(),
  })
  .passthrough()

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * Lowest listed total rate for a named property. Google Hotels' lowest rate is
 * usually a standard room, so it is recorded as a standard-room comparison.
 */
export async function searchHotelRate(
  apiKey: string,
  p: { property: string; checkIn: string; checkOut: string; adults: number },
  fetchImpl: typeof fetch = fetch,
): Promise<{ totalUsd: number; matchedName: string; cashProduct: CashProduct } | null> {
  const qs = new URLSearchParams({
    engine: 'google_hotels',
    q: p.property,
    check_in_date: p.checkIn,
    check_out_date: p.checkOut,
    adults: String(p.adults),
    currency: 'USD',
    hl: 'en',
    gl: 'us',
    api_key: apiKey,
  })
  const res = await fetchImpl(`${BASE}?${qs}`, { signal: AbortSignal.timeout(45_000) })
  if (!res.ok) throw new Error(`SerpApi responded ${res.status}`)
  const body = hotelsResponseSchema.parse(await res.json())
  if (body.error) {
    if (NO_RESULTS.test(body.error)) return null
    throw new Error(`SerpApi: ${body.error}`)
  }
  const want = norm(p.property)
  const match = (body.properties ?? []).find((x) => {
    const n = norm(x.name)
    return n === want || n.includes(want) || want.includes(n)
  })
  const total = match?.total_rate?.extracted_lowest
  if (!match || total == null || total <= 0) return null
  return {
    totalUsd: total,
    matchedName: match.name,
    cashProduct: { property: p.property, roomType: 'standard', guests: p.adults, checkIn: p.checkIn, checkOut: p.checkOut, mealsIncluded: false },
  }
}
