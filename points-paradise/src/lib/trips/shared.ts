/** Trip helpers that are safe to use in browser components (no database code). */
import type { TripItemKind } from '../db/schema'

export type { TripItemKind }

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
  costUsd: number | null
  points: number | null
  notes: string | null
  done: boolean
  dealId: string | null
}

export interface TripDayView {
  day: number
  date: string | null
}

export function toItemView(row: TripItemView & Record<string, unknown>): TripItemView {
  const { id, day, position, kind, title, time, place, url, costUsd, points, notes, done, dealId } = row
  return { id, day, position, kind, title, time, place, url, costUsd, points, notes, done, dealId }
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
