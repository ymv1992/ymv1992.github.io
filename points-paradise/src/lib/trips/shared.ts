/** Trip helpers that are safe to use in browser components (no database code). */
import type { PlacePhoto, TripBooking, TripItemKind } from '../db/schema'
import { isGoogleMapsLink } from '../places/google-maps-link'

export type { PlacePhoto, TripBooking, TripItemKind }

export const TRIP_ITEM_KINDS: { id: TripItemKind; label: string }[] = [
  { id: 'activity', label: 'Activity' },
  { id: 'food', label: 'Food & drink' },
  { id: 'flight', label: 'Flight' },
  { id: 'hotel', label: 'Stay' },
  { id: 'transport', label: 'Getting around' },
  { id: 'note', label: 'Note' },
]
export const TRIP_KIND_LABEL = Object.fromEntries(TRIP_ITEM_KINDS.map((k) => [k.id, k.label])) as Record<TripItemKind, string>

export interface TripItemView {
  id: string
  day: number | null
  position: number
  kind: TripItemKind
  title: string
  time: string | null
  place: string | null
  url: string | null
  costAmount: number | null
  costCurrency: string
  points: number | null
  notes: string | null
  done: boolean
  dealId: string | null
  lat: number | null
  lng: number | null
  mapSpan: number | null
  photo: PlacePhoto | null
  booking: TripBooking | null
  city: string | null
  countryCode: string | null
}

export interface TripDayView {
  day: number
  date: string | null
}

export function toItemView(row: TripItemView & Record<string, unknown>): TripItemView {
  const { id, day, position, kind, title, time, place, url, costAmount, costCurrency, points, notes, done, dealId, lat, lng, mapSpan, photo, booking, city, countryCode } = row
  return { id, day, position, kind, title, time, place, url, costAmount, costCurrency, points, notes, done, dealId, lat, lng, mapSpan, photo, booking: booking ?? null, city: city ?? null, countryCode: countryCode ?? null }
}

/** "Day 2 · Sat, Dec 5" (fixed to UTC so server and browser agree). */
export function dayHeading(d: TripDayView): string {
  if (!d.date) return `Day ${d.day}`
  const label = new Date(`${d.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
  return `Day ${d.day} · ${label}`
}

/** A Google Maps search for a place, narrowed by the trip's destination. No API key needed. */
export function mapsUrl(place: string, near?: string | null): string {
  const q = near && !place.toLowerCase().includes(near.toLowerCase()) ? `${place}, ${near}` : place
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`
}

/** Where "open in Google Maps" goes: the item's own Google Maps link, else its position, else a search for its place. */
export function itemMapsLink(item: Pick<TripItemView, 'url' | 'place' | 'lat' | 'lng'>, destination?: string | null): string | null {
  if (item.url && isGoogleMapsLink(item.url)) return item.url
  if (item.lat != null && item.lng != null) return `https://www.google.com/maps/search/?api=1&query=${item.lat},${item.lng}`
  return item.place ? mapsUrl(item.place, destination) : null
}

/** OpenStreetMap's free embeddable map centred on the place, with a pin. */
export function osmEmbedUrl(lat: number, lng: number, span?: number | null): string {
  const half = Math.min(1, Math.max(0.003, (span ?? 0.01) / 2))
  const latHalf = half * 0.6
  const bbox = [lng - half, lat - latHalf, lng + half, lat + latHalf].map((n) => n.toFixed(5)).join(',')
  return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${lat.toFixed(5)},${lng.toFixed(5)}`
}

function shortDay(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function plusDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
}

const dayOffset = (n: number | null | undefined) => (n ? ` (${n === 1 ? 'next day' : `+${n} days`})` : '')

/** One line under a flight or stay: "UA 1234 · LAX 08:00 → CUN 13:45" or "Check-in 15:00 · 3 nights". */
export function bookingSummary(item: Pick<TripItemView, 'kind' | 'time' | 'booking'>): string | null {
  const b = item.booking
  if (!b) return null
  if (item.kind === 'flight') {
    const s = b.schedule
    const depart = item.time ?? s?.departTime
    const arrive = b.arriveTime ?? s?.arriveTime
    const offset = b.arriveTime ? b.arriveDayOffset : s?.arriveDayOffset
    const route = b.from && b.to ? `${b.from}${depart ? ` ${depart}` : ''} → ${b.to}${arrive ? ` ${arrive}${offset ? ` (+${offset})` : ''}` : ''}` : null
    const parts = [b.flightNumber, route, b.aircraft ?? s?.aircraft].filter(Boolean)
    return parts.length ? parts.join(' · ') : b.confirmation ? `Confirmation ${b.confirmation}` : null
  }
  if (item.kind === 'hotel') {
    const parts = [item.time ? `Check-in ${item.time}` : null, b.nights ? `${b.nights} night${b.nights === 1 ? '' : 's'}` : null, b.checkOutTime ? `check-out ${b.checkOutTime}` : null].filter(Boolean)
    return parts.length ? parts.join(' · ') : b.confirmation ? `Confirmation ${b.confirmation}` : null
  }
  return b.confirmation ? `Confirmation ${b.confirmation}` : null
}

export interface BookingLine {
  label: string
  value: string
  note?: string
}

/**
 * Everything in the booking dropdown. `date` is the item's trip date (for the
 * check-out day). The shared page leaves out confirmation numbers.
 */
export function bookingLines(item: Pick<TripItemView, 'kind' | 'time' | 'booking'>, date: string | null, opts: { hideConfirmation?: boolean } = {}): BookingLine[] {
  const b = item.booking
  if (!b) return []
  const lines: BookingLine[] = []
  const add = (label: string, value: string | null | undefined, note?: string) => {
    if (value) lines.push({ label, value, ...(note ? { note } : {}) })
  }
  if (item.kind === 'flight') {
    const s = b.schedule
    add('Flight', [b.flightNumber, s?.airline].filter(Boolean).join(' · '))
    add('Route', b.from && b.to ? `${b.from} → ${b.to}` : null)
    add('Departs', item.time ?? s?.departTime, s && item.time && item.time !== s.departTime ? `Google Flights lists ${s.departTime}` : undefined)
    if (b.arriveTime) add('Arrives', `${b.arriveTime}${dayOffset(b.arriveDayOffset)}`, s && b.arriveTime !== s.arriveTime ? `Google Flights lists ${s.arriveTime}${dayOffset(s.arriveDayOffset)}` : undefined)
    else if (s) add('Arrives', `${s.arriveTime}${dayOffset(s.arriveDayOffset)}`)
    if (s?.durationMinutes) add('Flying time', `${Math.floor(s.durationMinutes / 60)}h ${String(s.durationMinutes % 60).padStart(2, '0')}m`)
    add('Aircraft', b.aircraft ?? s?.aircraft, b.aircraft && s?.aircraft && b.aircraft !== s.aircraft ? `Google Flights lists ${s.aircraft}` : undefined)
    add('Seat', b.seat)
  }
  if (item.kind === 'hotel') {
    add('Check-in', [date ? shortDay(date) : null, item.time].filter(Boolean).join(' · ') || null)
    const out = date && b.nights ? shortDay(plusDays(date, b.nights)) : null
    add('Check-out', [out, b.checkOutTime].filter(Boolean).join(' · ') || null)
    add('Nights', b.nights ? String(b.nights) : null)
    add('Phone', b.phone)
  }
  if (!opts.hideConfirmation) add('Confirmation', b.confirmation)
  return lines
}

/** Where a flight's looked-up times and aircraft came from, shown once under the details. */
export function bookingSource(item: Pick<TripItemView, 'kind' | 'booking'>): string | null {
  const s = item.booking?.schedule
  if (item.kind !== 'flight' || !s) return null
  return `Times${s.aircraft ? ' and aircraft' : ''} from Google Flights, checked ${shortDay(s.checkedAt.slice(0, 10))}. Airlines sometimes change planes, so check again closer to the day.`
}

/** A flight that can be looked up in Google Flights: it has a number, both airports and a date. */
export function canLookUpFlight(item: Pick<TripItemView, 'kind' | 'booking'>, date: string | null, today: string): boolean {
  const b = item.booking
  return item.kind === 'flight' && !!b?.flightNumber && !!b.from && !!b.to && !!date && date >= today
}
