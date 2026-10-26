/**
 * rooms.aero Partner API — hotel award search. Same key as seats.aero, with
 * its own 1,000 calls/day quota.
 *
 * The official reference (developers.seats.aero, "Rooms") was not reachable
 * when this was written. Paths, parameters and fields follow two public
 * clients (github.com/baeleb/seats-MCP and github.com/10/seats-aero-cli):
 * base https://rooms.aero/partnerapi, `Partner-Authorization: <key>`,
 * GET /search with start_date, end_date, location, nights (1–5), source,
 * take (≤500); envelope { data, count, has_more, more_url }; points are whole
 * numbers for the stay and cash is in minor units. Parsing is lenient and
 * every request records what came back, so a format surprise is visible in
 * Settings → Usage rather than silently empty.
 */
import { z } from 'zod'
import type { Region } from '../domain/constants'
import { dealDedupeKey, type DealColumns } from '../data/deal-input'
import { allCountries, regionForCountryCode } from '../geo/airports'

export const ROOMS_AERO_BASE = 'https://rooms.aero/partnerapi'

/** Chase hotel partners and their rooms.aero program keys. */
export const ROOMS_PROGRAMS: Record<string, string> = { hyatt: 'hyatt', marriott: 'marriott', ihg: 'ihg', wyndham: 'wyndham' }
const PARTNER_BY_SOURCE = Object.fromEntries(Object.entries(ROOMS_PROGRAMS).map(([partner, source]) => [source, partner]))

const num = z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().nullable())
const str = z.union([z.string(), z.number()]).transform(String).nullish()

const hotelSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    source: z.string().nullish(),
    program: z.string().nullish(),
    name: z.string(),
    brand: z.string().nullish(),
    award_category: str,
    city: z.string().nullish(),
    state: z.string().nullish(),
    country: z.string().nullish(),
    latitude: num.optional(),
    longitude: num.optional(),
    image_url: z.string().nullish(),
    url: z.string().nullish(),
    last_checked_at: z.string().nullish(),
  })
  .passthrough()

const searchRowSchema = z.object({
  hotel: hotelSchema,
  lowest_award_standard: num.optional(),
  lowest_award_suite: num.optional(),
  lowest_cash_standard: num.optional(),
  lowest_cash_suite: num.optional(),
  currency_code: z.string().nullish(),
  standard_date: z.string().nullish(),
  suite_date: z.string().nullish(),
  standard_nights: num.optional(),
  suite_nights: num.optional(),
  cpp: num.optional(),
  last_checked_at: z.string().nullish(),
})

const envelopeSchema = z.object({
  data: z.array(z.unknown()),
  count: num.optional(),
  has_more: z.boolean().nullish(),
  more_url: z.string().nullish(),
})

export type HotelSearchRow = z.infer<typeof searchRowSchema>

export interface HotelSearchParams {
  /** Free-text place rooms.aero geocodes, e.g. "Maui, Hawaii". */
  location: string
  startDate: string
  endDate: string
  nights: number
  /** rooms.aero program keys, e.g. ["hyatt", "marriott"]. */
  sources: string[]
}

export interface HotelSearchResult {
  rows: HotelSearchRow[]
  requests: number
  skippedMalformed: number
  truncated: boolean
  /** rooms.aero could not place the location; not a failure. */
  locationNotFound: boolean
  firstIssue?: string
  sample?: string
}

const PAGE_SIZE = 100

/** One hotel search: hotels with award space in an area, cheapest first. Throws on HTTP errors. */
export async function hotelSearch(apiKey: string, p: HotelSearchParams, fetchImpl: typeof fetch = fetch): Promise<HotelSearchResult> {
  const qs = new URLSearchParams({
    location: p.location,
    start_date: p.startDate,
    end_date: p.endDate,
    nights: String(Math.min(5, Math.max(1, Math.round(p.nights)))),
    source: p.sources.join(','),
    take: String(PAGE_SIZE),
  })
  const res = await fetchImpl(`${ROOMS_AERO_BASE}/search?${qs}`, {
    headers: { 'Partner-Authorization': apiKey, accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) {
    let code = ''
    try {
      const body = (await res.json()) as { error?: unknown; message?: unknown }
      code = [body.error, body.message].filter((x) => typeof x === 'string').join(': ')
    } catch {
      // Not JSON; the status is enough.
    }
    if (/location_not_found/.test(code)) return { rows: [], requests: 1, skippedMalformed: 0, truncated: false, locationNotFound: true }
    throw new Error(`rooms.aero responded ${res.status}${code ? ` (${code.slice(0, 160)})` : ''}`)
  }
  const body = envelopeSchema.parse(await res.json())
  const rows: HotelSearchRow[] = []
  let skipped = 0
  let firstIssue: string | undefined
  let sample: string | undefined
  for (const raw of body.data) {
    const r = searchRowSchema.safeParse(raw)
    if (r.success) rows.push(r.data)
    else {
      skipped++
      if (!firstIssue) {
        const i = r.error.issues[0]
        firstIssue = i ? `${i.path.join('.') || 'row'}: ${i.message}` : 'unreadable'
        sample = JSON.stringify(raw).slice(0, 600)
      }
    }
  }
  return { rows, requests: 1, skippedMalformed: skipped, truncated: body.has_more === true || body.data.length >= PAGE_SIZE, locationNotFound: false, firstIssue, sample }
}

/** Counts worth recording with each request, so an empty-looking search can be explained. */
export function hotelDiagnostics(res: HotelSearchResult): Record<string, unknown> {
  return {
    returned: res.rows.length + res.skippedMalformed,
    unreadable: res.skippedMalformed,
    sources: [...new Set(res.rows.map((r) => r.hotel.source ?? r.hotel.program ?? '?'))].slice(0, 12),
    ...(res.locationNotFound ? { locationNotFound: true } : {}),
    ...(res.firstIssue ? { firstIssue: res.firstIssue } : {}),
    ...(res.sample ? { sample: res.sample } : {}),
  }
}

let countryByName: Map<string, string> | null = null
function countryCode(country: string | null | undefined): string | null {
  if (!country) return null
  const c = country.trim()
  if (/^[A-Za-z]{2}$/.test(c)) return c.toUpperCase()
  countryByName ??= new Map(allCountries().map((x) => [x.name.toLowerCase(), x.code]))
  return countryByName.get(c.toLowerCase()) ?? null
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

const LUXURY_BRANDS = /park hyatt|alila|andaz|miraval|ritz|st\.? regis|edition|luxury collection|w hotels?|jw marriott|six senses|regent|intercontinental|kimpton|thompson|hyatt vacation|unbound/i

export interface HotelPlace {
  label: string
  region: Region
  tags: string[]
}

type HotelDeal = DealColumns & { sourceKind: 'api'; sourceRef: string; verificationMethod: string; verifiedAt: Date | null }

/**
 * Turns one search row into up to two deals (standard room and suite) for
 * Chase hotel partners. rooms.aero gives the cash rate for the same stay, so
 * these deals arrive with a comparable cash price.
 */
export function hotelRowToDeals(row: HotelSearchRow, place: HotelPlace, requestedNights: number, method: string): HotelDeal[] {
  const h = row.hotel
  const programId = PARTNER_BY_SOURCE[(h.source ?? h.program ?? '').toLowerCase()]
  if (!programId) return []
  const cc = countryCode(h.country)
  const usd = !row.currency_code || row.currency_code.toUpperCase() === 'USD'
  const checked = row.last_checked_at ?? h.last_checked_at ?? null
  const checkedAt = checked && !Number.isNaN(Date.parse(checked)) ? new Date(checked) : null
  const httpsOrNull = (u: string | null | undefined) => (u && /^https:\/\//.test(u) ? u : null)
  const luxury = LUXURY_BRANDS.test(`${h.brand ?? ''} ${h.name}`)
  const out: HotelDeal[] = []
  for (const kind of ['standard', 'suite'] as const) {
    const points = kind === 'standard' ? row.lowest_award_standard : row.lowest_award_suite
    const date = (kind === 'standard' ? row.standard_date : row.suite_date)?.slice(0, 10)
    if (!points || points <= 0 || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    const nights = (kind === 'standard' ? row.standard_nights : row.suite_nights) || requestedNights
    const cashMinor = kind === 'standard' ? row.lowest_cash_standard : row.lowest_cash_suite
    const cash = usd && cashMinor && cashMinor > 0 ? Math.round(cashMinor) / 100 : null
    const checkOut = addDays(date, nights)
    const roomType = kind === 'standard' ? 'standard' : 'suite'
    out.push({
      dedupeKey: dealDedupeKey({
        kind: 'hotel',
        programId,
        originAirport: null,
        destAirport: null,
        destCity: h.city ?? place.label,
        travelStart: date,
        travelEnd: checkOut,
        cabin: null,
        flightNumbers: [],
        property: h.name,
        roomType,
      }),
      kind: 'hotel',
      title: `${h.name} — ${nights} night${nights === 1 ? '' : 's'}${kind === 'suite' ? ', suite' : ''}`,
      destCity: h.city ?? place.label,
      destCountry: h.country ?? '',
      destCountryCode: cc,
      destRegion: cc ? regionForCountryCode(cc) : place.region,
      destAirport: null,
      destLat: h.latitude ?? null,
      destLon: h.longitude ?? null,
      originAirport: null,
      providerName: h.brand ? `${h.brand}` : h.name,
      programId,
      programPoints: Math.round(points),
      // Award nights at these programs carry no taxes; some hotels add resort fees (listed as missing).
      mandatoryCashUsd: 0,
      comparableCashUsd: cash,
      comparableCashSource: cash != null ? 'live_api' : 'unknown',
      comparableCashObservedAt: cash != null ? checkedAt : null,
      alternativeCashUsd: null,
      travelStart: date,
      travelEnd: checkOut,
      nights,
      flexibleDates: false,
      flight: null,
      hotel: {
        property: h.name,
        roomCategory: kind === 'standard' ? 'Standard room (award)' : 'Suite (award)',
        roomType,
        guests: null,
        meals: null,
        cancellation: null,
        resortFeeUsd: null,
        mandatoryTransfer: null,
        isStandardAward: kind === 'standard',
        programCategory: h.award_category ? `Category ${h.award_category}`.slice(0, 60) : null,
        roomVerified: false,
      },
      cashProduct: cash != null ? { property: h.name, roomType, checkIn: date, checkOut, guests: null } : null,
      tags: [...new Set([...place.tags, ...(luxury || kind === 'suite' ? ['luxury'] : [])])],
      sourceName: 'rooms.aero',
      sourceUrl: httpsOrNull(h.url),
      bookingUrl: httpsOrNull(h.url),
      imageUrl: httpsOrNull(h.image_url),
      availability: 'available',
      missingInfo: [
        ...(cash == null ? ['Comparable cash price'] : []),
        'Resort or destination fees (some hotels charge them on award stays)',
        'Exact room and bed type',
      ],
      deadlineType: 'observed',
      deadlineAt: null,
      deadlineTimezone: null,
      deadlineSource: 'rooms.aero cached availability',
      whyNoteworthy: null,
      sourceKind: 'api',
      sourceRef: `rooms:${h.id}:${date}:${nights}:${kind}`,
      verificationMethod: method,
      verifiedAt: checkedAt,
    })
  }
  return out
}
