/**
 * seats.aero Partner API — cached award search.
 *
 * Endpoint and fields follow developers.seats.aero (cached search,
 * `Partner-Authorization` header) as mirrored by the unofficial Go client
 * github.com/denverquane/seats-aero-go. Pro API access is for personal,
 * non-commercial use only and is limited to 1,000 calls/day.
 *
 * Assumption to verify against the live docs: `*TotalTaxes` are in minor
 * units (cents) of `TaxesCurrency`. Values that look implausible are dropped
 * rather than trusted.
 */
import { z } from 'zod'
import type { Cabin } from '../domain/constants'
import { dealDedupeKey, type DealColumns } from '../data/deal-input'
import { SEATS_AERO_PROGRAMS } from '../data/watchlists'
import { getAirport } from '../geo/airports'

export const SEATS_AERO_BASE = 'https://seats.aero/partnerapi'

const num = z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().nullable())

const itemSchema = z.object({
  ID: z.string(),
  Route: z
    .object({
      OriginAirport: z.string(),
      DestinationAirport: z.string(),
      Distance: num.optional(),
      Source: z.string().optional(),
    })
    .passthrough(),
  Date: z.string(),
  Source: z.string(),
  YAvailable: z.boolean().optional(),
  WAvailable: z.boolean().optional(),
  JAvailable: z.boolean().optional(),
  FAvailable: z.boolean().optional(),
  YMileageCost: z.union([z.string(), z.number()]).optional(),
  WMileageCost: z.union([z.string(), z.number()]).optional(),
  JMileageCost: z.union([z.string(), z.number()]).optional(),
  FMileageCost: z.union([z.string(), z.number()]).optional(),
  YMileageCostRaw: num.optional(),
  WMileageCostRaw: num.optional(),
  JMileageCostRaw: num.optional(),
  FMileageCostRaw: num.optional(),
  YTotalTaxes: num.optional(),
  WTotalTaxes: num.optional(),
  JTotalTaxes: num.optional(),
  FTotalTaxes: num.optional(),
  TaxesCurrency: z.string().nullish(),
  YAirlines: z.string().nullish(),
  WAirlines: z.string().nullish(),
  JAirlines: z.string().nullish(),
  FAirlines: z.string().nullish(),
  YDirect: z.boolean().optional(),
  WDirect: z.boolean().optional(),
  JDirect: z.boolean().optional(),
  FDirect: z.boolean().optional(),
  UpdatedAt: z.string().optional(),
})

const responseSchema = z.object({
  data: z.array(z.unknown()),
  count: z.number().optional(),
  hasMore: z.boolean().optional(),
  cursor: z.number().nullish(),
})

export type SeatsAeroItem = z.infer<typeof itemSchema>

const CABIN_CODE: Record<Cabin, 'Y' | 'W' | 'J' | 'F'> = { economy: 'Y', premium_economy: 'W', business: 'J', first: 'F' }
const API_CABIN: Record<Cabin, string> = { economy: 'economy', premium_economy: 'premium', business: 'business', first: 'first' }

export interface CachedSearchParams {
  origins: string[]
  destinations: string[]
  cabin: Cabin
  startDate: string
  endDate: string
}

export interface CachedSearchResult {
  items: SeatsAeroItem[]
  requests: number
  skippedMalformed: number
}

/** One cached search (single request, up to 500 results). Throws on HTTP errors. */
export async function cachedSearch(apiKey: string, p: CachedSearchParams, fetchImpl: typeof fetch = fetch): Promise<CachedSearchResult> {
  const qs = new URLSearchParams({
    origin_airport: p.origins.join(','),
    destination_airport: p.destinations.join(','),
    start_date: p.startDate,
    end_date: p.endDate,
    cabin: API_CABIN[p.cabin],
    take: '500',
  })
  const res = await fetchImpl(`${SEATS_AERO_BASE}/search?${qs}`, {
    headers: { 'Partner-Authorization': apiKey, accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`seats.aero responded ${res.status}`)
  const body = responseSchema.parse(await res.json())
  const items: SeatsAeroItem[] = []
  let skipped = 0
  for (const raw of body.data) {
    const r = itemSchema.safeParse(raw)
    if (r.success) items.push(r.data)
    else skipped++
  }
  return { items, requests: 1, skippedMalformed: skipped }
}

const PROGRAM_BY_SOURCE = Object.fromEntries(Object.entries(SEATS_AERO_PROGRAMS).map(([program, source]) => [source, program]))

function parseMiles(raw: number | null | undefined, text: string | number | undefined): number | null {
  if (raw != null && raw > 0) return Math.round(raw)
  if (text == null) return null
  const n = Number(String(text).replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null
}

/**
 * Converts a cached-search row into deal columns for one cabin. Returns null
 * when the cabin is not available or the program is not a Chase partner.
 */
export function itemToDealColumns(item: SeatsAeroItem, cabin: Cabin): (DealColumns & { sourceKind: 'api'; sourceRef: string; verificationMethod: string; verifiedAt: Date | null }) | null {
  const c = CABIN_CODE[cabin]
  if (!item[`${c}Available`]) return null
  const programId = PROGRAM_BY_SOURCE[item.Source]
  if (!programId) return null
  const miles = parseMiles(item[`${c}MileageCostRaw`], item[`${c}MileageCost`])
  if (!miles) return null
  const taxesMinor = item[`${c}TotalTaxes`]
  const usdTaxes = item.TaxesCurrency === 'USD' && taxesMinor != null ? taxesMinor / 100 : null
  const taxes = usdTaxes != null && usdTaxes >= 0 && usdTaxes < 3000 ? usdTaxes : null
  const dest = getAirport(item.Route.DestinationAirport)
  const date = item.Date.slice(0, 10)
  const airlines = item[`${c}Airlines`] || 'Multiple airlines'
  const direct = item[`${c}Direct`]
  const missing = ['Comparable cash price', 'Seat type', 'Aircraft']
  if (taxes == null) missing.unshift('Taxes and fees')
  const updated = item.UpdatedAt ? new Date(item.UpdatedAt) : null
  return {
    dedupeKey: dealDedupeKey({
      kind: 'flight',
      programId,
      originAirport: item.Route.OriginAirport,
      destAirport: item.Route.DestinationAirport,
      destCity: dest?.city ?? item.Route.DestinationAirport,
      travelStart: date,
      travelEnd: null,
      cabin,
      flightNumbers: [],
      property: null,
      roomType: null,
    }),
    kind: 'flight',
    title: `${airlines} — ${cabin.replace('_', ' ')} to ${dest?.city ?? item.Route.DestinationAirport}`,
    destCity: dest?.city ?? item.Route.DestinationAirport,
    destCountry: dest?.countryName ?? '',
    destCountryCode: dest?.countryCode ?? null,
    destRegion: dest?.region ?? 'north_america',
    destAirport: item.Route.DestinationAirport,
    destLat: dest?.lat ?? null,
    destLon: dest?.lon ?? null,
    originAirport: item.Route.OriginAirport,
    providerName: airlines,
    programId,
    programPoints: miles,
    mandatoryCashUsd: taxes,
    comparableCashUsd: null,
    comparableCashSource: 'unknown',
    comparableCashObservedAt: null,
    alternativeCashUsd: null,
    travelStart: date,
    travelEnd: null,
    nights: null,
    flexibleDates: false,
    flight: {
      cabin,
      seatType: 'unknown',
      operatingAirline: airlines,
      flightNumbers: [],
      aircraft: null,
      stops: direct === true ? 0 : null,
      connectionMinutes: [],
      durationMinutes: null,
      mixedCabin: null,
      directAisleAccess: null,
      overnightLayover: null,
      separateTickets: false,
      aircraftVerified: false,
    },
    hotel: null,
    cashProduct: null,
    tags: [],
    sourceName: 'seats.aero cached search',
    sourceUrl: null,
    bookingUrl: null,
    imageUrl: null,
    availability: 'available',
    missingInfo: missing,
    deadlineType: 'observed',
    deadlineAt: null,
    deadlineTimezone: null,
    deadlineSource: 'seats.aero cached availability',
    whyNoteworthy: null,
    sourceKind: 'api',
    sourceRef: item.ID,
    verificationMethod: 'seats.aero cached search',
    verifiedAt: updated && !Number.isNaN(updated.getTime()) ? updated : null,
  }
}
