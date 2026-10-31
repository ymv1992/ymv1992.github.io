/** Booking details on trip items: what is kept per kind, edits, Google Flights lookups, and what the shared copy hides (TEST FIXTURES). */
import { inflateSync } from 'node:zlib'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { PDFDocument } from 'pdf-lib'
import type { AppDb } from '@/lib/db/client'
import { searchJobs, tripItems } from '@/lib/db/schema'
import { ensureOwnerAccount } from '@/lib/data/account'
import { lookUpTripFlight } from '@/lib/data/trip-flights'
import { addTripItem, cleanBooking, createTrip, getTrip, mergeBooking, normalizeFlightNumber, tripBookingInputSchema, tripInputSchema, updateTripItem, type TripItemInput } from '@/lib/data/trips'
import { findScheduledFlight } from '@/lib/providers/serpapi'
import { bookingLines, bookingSource, bookingSummary, canLookUpFlight } from '@/lib/trips/shared'
import { buildTripPdf } from '@/lib/trips/trip-pdf'
import { NOW } from '../fixtures'
import { json, router } from '../place-fixtures'
import { createTestDb } from '../test-db'

let db: AppDb
let userId: string
let tripId: string

const item = (title: string, extra: Partial<TripItemInput> = {}): TripItemInput => ({ kind: 'activity', title, day: 1, time: null, place: null, url: null, costAmount: null, costCurrency: 'USD', points: null, notes: null, ...extra })

/** A Google Flights answer (via SerpApi) listing UA 1234 nonstop and a connection that uses it. */
const googleFlights = (calls: URL[] = []) =>
  router(
    {
      'serpapi.com': (u) => {
        calls.push(u)
        return json({
          best_flights: [
            {
              flights: [
                {
                  departure_airport: { id: 'LAX', time: '2026-12-04 23:10' },
                  arrival_airport: { id: 'CUN', time: '2026-12-05 06:45' },
                  airline: 'United',
                  flight_number: 'UA 1234',
                  airplane: 'Boeing 737MAX 9 Passenger',
                  duration: 275,
                },
              ],
              price: 289,
            },
          ],
          other_flights: [
            {
              flights: [
                { departure_airport: { id: 'LAX', time: '2026-12-04 07:00' }, arrival_airport: { id: 'IAH', time: '2026-12-04 12:10' }, flight_number: 'UA 999', airplane: 'Airbus A320' },
                { departure_airport: { id: 'IAH', time: '2026-12-04 14:00' }, arrival_airport: { id: 'CUN', time: '2026-12-04 17:05' }, flight_number: 'UA 1234', airplane: 'Boeing 737-800' },
              ],
              price: 250,
            },
          ],
        })
      },
    },
    [],
  )

beforeAll(async () => {
  db = await createTestDb()
  userId = await ensureOwnerAccount(db, 'owner@example.com')
  tripId = await createTrip(db, userId, tripInputSchema.parse({ name: 'Cancún', destination: 'Cancún, Mexico', startDate: '2026-12-04', endDate: '2026-12-08' }))
}, 60_000)

beforeEach(async () => {
  await db.delete(searchJobs)
})

describe('booking details', () => {
  it('read flight numbers the way people type them', () => {
    expect(normalizeFlightNumber('ua1234')).toBe('UA 1234')
    expect(normalizeFlightNumber('UA 0123')).toBe('UA 123')
    expect(normalizeFlightNumber('b6-55')).toBe('B6 55')
    expect(normalizeFlightNumber('1234')).toBeNull()
    expect(normalizeFlightNumber('United 12')).toBeNull()
  })

  it('keep only the fields that fit the kind of item, and nothing when all are empty', () => {
    const typed = tripBookingInputSchema.parse({ confirmation: ' k7q2pz ', flightNumber: 'ua1234', from: 'lax', to: 'CUN', arriveTime: '06:45', arriveDayOffset: '1', seat: '14A', nights: '3', checkOutTime: '', phone: '' })
    expect(cleanBooking('flight', typed)).toEqual({ confirmation: 'K7Q2PZ', flightNumber: 'UA 1234', from: 'LAX', to: 'CUN', arriveTime: '06:45', arriveDayOffset: 1, seat: '14A' })
    expect(cleanBooking('hotel', typed)).toEqual({ confirmation: 'K7Q2PZ', nights: 3 })
    expect(cleanBooking('activity', typed)).toEqual({ confirmation: 'K7Q2PZ' })
    expect(cleanBooking('note', typed)).toBeNull()
    expect(cleanBooking('flight', tripBookingInputSchema.parse({ confirmation: '', arriveDayOffset: '0' }))).toBeNull()
    expect(tripBookingInputSchema.safeParse({ flightNumber: 'United' }).error?.issues[0]?.message).toBe('Use a flight number like UA 1234')
    expect(tripBookingInputSchema.safeParse({ from: 'Los Angeles' }).success).toBe(false)
  })

  it('keep a looked-up schedule through edits, and drop it when the flight itself changes', () => {
    const schedule = { date: '2026-12-04', flightNumber: 'UA 1234', from: 'LAX', to: 'CUN', departTime: '23:10', arriveTime: '06:45', arriveDayOffset: 1, durationMinutes: 275, aircraft: 'Boeing 737MAX 9 Passenger', airline: 'United', checkedAt: NOW.toISOString() }
    const prev = { flightNumber: 'UA 1234', from: 'LAX', to: 'CUN', aircraft: 'Boeing 737MAX 9 Passenger', schedule }
    expect(mergeBooking(prev, { flightNumber: 'UA 1234', from: 'LAX', to: 'CUN', seat: '3A' }, true)).toEqual({ flightNumber: 'UA 1234', from: 'LAX', to: 'CUN', seat: '3A', schedule })
    // Another flight: the schedule and the aircraft copied from it go; the owner's own aircraft stays.
    expect(mergeBooking(prev, { flightNumber: 'UA 77', from: 'LAX', to: 'CUN', aircraft: 'Boeing 737MAX 9 Passenger' }, true)).toEqual({ flightNumber: 'UA 77', from: 'LAX', to: 'CUN' })
    expect(mergeBooking(prev, { flightNumber: 'UA 1234', from: 'LAX', to: 'CUN', aircraft: 'A321neo' }, false)).toEqual({ flightNumber: 'UA 1234', from: 'LAX', to: 'CUN', aircraft: 'A321neo' })
  })

  it('are saved with the item and survive an edit that leaves them alone', async () => {
    const r = await addTripItem(db, userId, tripId, item('Hotel Xcaret', { kind: 'hotel', time: '15:00', booking: { confirmation: 'HX12345', nights: 3, checkOutTime: '11:00' } }))
    if (!r.ok) throw new Error(r.error)
    await updateTripItem(db, userId, r.id, item('Hotel Xcaret Arte', { kind: 'hotel', time: '15:00' }))
    const [row] = await db.select().from(tripItems).where(eq(tripItems.id, r.id))
    expect(row?.booking).toEqual({ confirmation: 'HX12345', nights: 3, checkOutTime: '11:00' })
  })

  it('show a short summary and a full list, with the check-out day worked out', () => {
    const stay = { kind: 'hotel' as const, time: '15:00', booking: { confirmation: 'HX12345', nights: 3, checkOutTime: '11:00', phone: '+52 998 000 0000' } }
    expect(bookingSummary(stay)).toBe('Check-in 15:00 · 3 nights · check-out 11:00')
    expect(bookingLines(stay, '2026-12-04')).toEqual([
      { label: 'Check-in', value: 'Fri, Dec 4 · 15:00' },
      { label: 'Check-out', value: 'Mon, Dec 7 · 11:00' },
      { label: 'Nights', value: '3' },
      { label: 'Phone', value: '+52 998 000 0000' },
      { label: 'Confirmation', value: 'HX12345' },
    ])
    // The shared page and shared PDF leave the confirmation number out.
    expect(bookingLines(stay, '2026-12-04', { hideConfirmation: true }).map((l) => l.label)).not.toContain('Confirmation')
    const flight = { kind: 'flight' as const, time: '23:10', booking: { flightNumber: 'UA 1234', from: 'LAX', to: 'CUN', arriveTime: '06:45', arriveDayOffset: 1 } }
    expect(bookingSummary(flight)).toBe('UA 1234 · LAX 23:10 → CUN 06:45 (+1)')
    expect(canLookUpFlight(flight, '2026-12-04', '2026-10-18')).toBe(true)
    expect(canLookUpFlight(flight, '2026-10-01', '2026-10-18')).toBe(false)
    expect(canLookUpFlight(flight, null, '2026-10-18')).toBe(false)
  })
})

describe('Google Flights schedule lookup', () => {
  it('finds the nonstop flight with that number between those airports', async () => {
    const f = await findScheduledFlight('k', { from: 'LAX', to: 'CUN', date: '2026-12-04', flightNumber: 'UA 1234' }, googleFlights())
    expect(f).toEqual({ flightNumber: 'UA 1234', airline: 'United', departTime: '23:10', arriveTime: '06:45', arriveDayOffset: 1, durationMinutes: 275, aircraft: 'Boeing 737MAX 9 Passenger' })
    // A connection's second flight starts somewhere else, so it never matches LAX → CUN.
    expect(await findScheduledFlight('k', { from: 'LAX', to: 'CUN', date: '2026-12-04', flightNumber: 'UA 999' }, googleFlights())).toBeNull()
  })

  it('fills the departure time and aircraft on the item, using one search', async () => {
    const r = await addTripItem(db, userId, tripId, item('Fly to Cancún', { kind: 'flight', booking: { flightNumber: 'UA 1234', from: 'LAX', to: 'CUN', confirmation: 'ABC123' } }))
    if (!r.ok) throw new Error(r.error)
    const calls: URL[] = []
    const out = await lookUpTripFlight(db, userId, r.id, { apiKey: 'k', now: NOW, fetch: googleFlights(calls), monthlyCapUsd: 10 })
    expect(out).toMatchObject({ ok: true, schedule: { departTime: '23:10', aircraft: 'Boeing 737MAX 9 Passenger', date: '2026-12-04' } })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.searchParams.get('outbound_date')).toBe('2026-12-04')
    const trip = await getTrip(db, userId, tripId)
    const saved = trip!.items.find((i) => i.id === r.id)!
    expect(saved.time).toBe('23:10')
    expect(saved.booking).toMatchObject({ confirmation: 'ABC123', schedule: { arriveTime: '06:45', arriveDayOffset: 1 } })
    expect(bookingLines(saved, '2026-12-04').find((l) => l.label === 'Aircraft')).toEqual({ label: 'Aircraft', value: 'Boeing 737MAX 9 Passenger' })
    expect(bookingSource(saved)).toBe('Times and aircraft from Google Flights, checked Sun, Oct 18. Airlines sometimes change planes, so check again closer to the day.')
    const [job] = await db.select().from(searchJobs)
    expect(job).toMatchObject({ provider: 'serpapi_flights', jobType: 'flight_details', status: 'succeeded', requestCount: 1 })
  })

  it('explains what is missing, and never searches past flights or past the monthly limit', async () => {
    const noNumber = await addTripItem(db, userId, tripId, item('Flight home', { kind: 'flight', booking: { from: 'CUN', to: 'LAX' } }))
    if (!noNumber.ok) throw new Error(noNumber.error)
    expect(await lookUpTripFlight(db, userId, noNumber.id, { apiKey: 'k', now: NOW, fetch: googleFlights(), monthlyCapUsd: 10 })).toEqual({
      ok: false,
      error: 'Add the flight number and both airports first (Edit → Booking details).',
    })
    const later = await addTripItem(db, userId, tripId, item('Flight', { kind: 'flight', booking: { flightNumber: 'UA 1234', from: 'LAX', to: 'CUN' } }))
    if (!later.ok) throw new Error(later.error)
    const calls: URL[] = []
    expect(await lookUpTripFlight(db, userId, later.id, { apiKey: 'k', now: new Date('2027-01-01T00:00:00Z'), fetch: googleFlights(calls), monthlyCapUsd: 10 })).toEqual({
      ok: false,
      error: 'Google Flights only lists upcoming flights.',
    })
    await db.insert(searchJobs).values({ provider: 'serpapi_flights', jobType: 'cash_lookup', status: 'succeeded', requestCount: 200, startedAt: NOW, createdAt: NOW })
    const capped = await lookUpTripFlight(db, userId, later.id, { apiKey: 'k', now: NOW, fetch: googleFlights(calls), monthlyCapUsd: 10 })
    expect(capped.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('belong to the trip owner only', async () => {
    const other = await ensureOwnerAccount(db, 'other@example.com')
    const r = await addTripItem(db, userId, tripId, item('Mine', { kind: 'flight', booking: { flightNumber: 'UA 1234', from: 'LAX', to: 'CUN' } }))
    if (!r.ok) throw new Error(r.error)
    expect(await lookUpTripFlight(db, other, r.id, { apiKey: 'k', now: NOW, fetch: googleFlights(), monthlyCapUsd: 10 })).toEqual({ ok: false, error: 'Not found' })
  })
})

describe('PDF itinerary', () => {
  it('lists booking details, and leaves confirmation numbers out of shared copies', async () => {
    const trip = (await getTrip(db, userId, tripId))!
    const own = await buildTripPdf(trip.trip, trip.items, NOW)
    const shared = await buildTripPdf(trip.trip, trip.items, NOW, { hideConfirmation: true })
    expect((await PDFDocument.load(own)).getPageCount()).toBeGreaterThan(0)
    // Page contents are compressed, and pdf-lib writes text as hex strings: unpack them and look for the encoded number.
    const text = (bytes: Uint8Array) => {
      const raw = Buffer.from(bytes)
      let out = ''
      for (let at = raw.indexOf('stream'); at !== -1; at = raw.indexOf('stream', at + 6)) {
        const start = raw[at + 6] === 0x0d ? at + 8 : at + 7
        const end = raw.indexOf('endstream', start)
        if (end === -1) break
        try {
          out += inflateSync(raw.subarray(start, end)).toString('latin1')
        } catch {
          // Not a compressed stream.
        }
        at = end
      }
      return out.toUpperCase()
    }
    const hex = Buffer.from('HX12345', 'latin1').toString('hex').toUpperCase()
    expect(text(own)).toContain(hex)
    expect(text(shared)).not.toContain(hex)
  })
})
