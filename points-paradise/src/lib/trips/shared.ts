/** Trip helpers that are safe to use in browser components (no database code). */
import type { PlacePhoto, TripItemKind } from '../db/schema'
import { isGoogleMapsLink } from '../places/google-maps-link'

export type { PlacePhoto, TripItemKind }

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
}

export interface TripDayView {
  day: number
  date: string | null
}

export function toItemView(row: TripItemView & Record<string, unknown>): TripItemView {
  const { id, day, position, kind, title, time, place, url, costAmount, costCurrency, points, notes, done, dealId, lat, lng, mapSpan, photo } = row
  return { id, day, position, kind, title, time, place, url, costAmount, costCurrency, points, notes, done, dealId, lat, lng, mapSpan, photo }
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
