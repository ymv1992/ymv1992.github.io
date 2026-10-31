/**
 * OpenStreetMap's free place search (Nominatim). Its usage policy asks for at
 * most one request a second, an identifying User-Agent and caching of
 * results; callers go through lib/data/place-media.ts, which does all three.
 */
import { z } from 'zod'

export const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org'
export const PLACES_USER_AGENT = 'PointsParadise/1.0 (personal trip planner; https://github.com/ymv1992/ymv1992.github.io)'

const resultSchema = z
  .object({
    lat: z.coerce.number(),
    lon: z.coerce.number(),
    name: z.string().optional(),
    display_name: z.string().optional(),
    boundingbox: z.array(z.coerce.number()).length(4).optional(),
    extratags: z.record(z.string(), z.string().nullable()).nullable().optional(),
  })
  .passthrough()

export interface GeoResult {
  lat: number
  lng: number
  name: string | null
  /** Width of the place in degrees (from its bounding box). */
  span: number | null
  wikipedia: string | null
  wikidata: string | null
}

/** Best match for a place name, or null. */
export async function geocode(query: string, fetchImpl: typeof fetch = fetch): Promise<GeoResult | null> {
  const qs = new URLSearchParams({ q: query.slice(0, 200), format: 'jsonv2', limit: '1', extratags: '1', addressdetails: '0' })
  const res = await fetchImpl(`${NOMINATIM_BASE}/search?${qs}`, {
    headers: { 'User-Agent': PLACES_USER_AGENT, 'Accept-Language': 'en' },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`Nominatim responded ${res.status}`)
  const rows = z.array(z.unknown()).parse(await res.json())
  const first = rows.length ? resultSchema.safeParse(rows[0]) : null
  if (!first?.success) return null
  const r = first.data
  const [south, north, west, east] = r.boundingbox ?? []
  const span = south != null && north != null && west != null && east != null ? Math.max(north - south, east - west) : null
  return {
    lat: r.lat,
    lng: r.lon,
    name: r.name || r.display_name?.split(',')[0]?.trim() || null,
    span,
    wikipedia: r.extratags?.wikipedia ?? null,
    wikidata: r.extratags?.wikidata ?? null,
  }
}

const reverseSchema = z
  .object({
    lat: z.coerce.number().optional(),
    lon: z.coerce.number().optional(),
    address: z.record(z.string(), z.string()).optional(),
    error: z.string().optional(),
  })
  .passthrough()

export interface CityResult {
  city: string
  /** ISO country code in capitals, like "PT". */
  countryCode: string | null
}

/** The town or city at a point (OpenStreetMap reverse lookup at city level), or null. */
export async function reverseCity(lat: number, lng: number, fetchImpl: typeof fetch = fetch): Promise<CityResult | null> {
  const qs = new URLSearchParams({ lat: lat.toFixed(5), lon: lng.toFixed(5), format: 'jsonv2', zoom: '10', addressdetails: '1' })
  const res = await fetchImpl(`${NOMINATIM_BASE}/reverse?${qs}`, {
    headers: { 'User-Agent': PLACES_USER_AGENT, 'Accept-Language': 'en' },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`Nominatim responded ${res.status}`)
  const r = reverseSchema.safeParse(await res.json())
  if (!r.success || r.data.error || !r.data.address) return null
  const a = r.data.address
  const city = a.city || a.town || a.village || a.municipality || a.city_district || a.county || a.state_district || a.state
  if (!city) return null
  return { city, countryCode: a.country_code ? a.country_code.toUpperCase() : null }
}
