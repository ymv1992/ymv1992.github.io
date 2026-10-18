import { z } from 'zod'
import {
  AVAILABILITY,
  CABINS,
  CASH_SOURCES,
  DEAL_KINDS,
  ROOM_TYPES,
  SEAT_TYPES,
  TRAVEL_TAGS,
  type Region,
} from '../domain/constants'
import type { CashProduct, FlightDetails, HotelDetails } from '../domain/types'
import { getAirport, regionForCountryCode } from '../geo/airports'

const emptyToNull = (v: unknown) => (v === '' || v === undefined ? null : v)
const optText = (max: number) => z.preprocess(emptyToNull, z.string().trim().max(max).nullable())
const optNum = (min: number, max: number) => z.preprocess(emptyToNull, z.coerce.number().min(min).max(max).nullable())
const optInt = (min: number, max: number) => z.preprocess(emptyToNull, z.coerce.number().int().min(min).max(max).nullable())
const optBool = z.preprocess((v) => (v === '' || v == null ? null : v === true || v === 'true' || v === 'on' || v === '1'), z.boolean().nullable())
const bool = z.preprocess((v) => v === true || v === 'true' || v === 'on' || v === '1', z.boolean())
const isoDate = z.preprocess(emptyToNull, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullable())
const iata = z.preprocess(
  (v) => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim().toUpperCase()) : emptyToNull(v)),
  z.string().regex(/^[A-Z]{3}$/, 'Use a 3-letter airport code').nullable(),
)
/** Only absolute http(s) URLs are accepted, so nothing like javascript: can be stored. */
const httpUrl = z.preprocess(
  emptyToNull,
  z
    .string()
    .trim()
    .max(2000)
    .url()
    .refine((u) => /^https?:\/\//i.test(u), 'Must start with http:// or https://')
    .nullable(),
)
const list = (max: number) =>
  z.preprocess(
    (v) =>
      Array.isArray(v)
        ? v
        : typeof v === 'string'
          ? v
              .split(/[,;|]/)
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
    z.array(z.string().max(60)).max(max),
  )

/** Flat input used by the manual entry form, the JSON/CSV importer and adapters. */
export const manualDealSchema = z
  .object({
    kind: z.enum(DEAL_KINDS),
    title: optText(200),
    destCity: z.string().trim().min(1, 'Destination city is required').max(120),
    destCountry: optText(120),
    destCountryCode: z.preprocess(
      (v) => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim().toUpperCase()) : emptyToNull(v)),
      z.string().regex(/^[A-Z]{2}$/, 'Use a 2-letter country code').nullable(),
    ),
    destAirport: iata,
    originAirport: iata,
    providerName: z.string().trim().min(1, 'Airline, hotel or provider is required').max(200),
    programId: z.string().trim().min(1, 'Choose how the award is booked').max(60),
    programPoints: optInt(0, 5_000_000),
    mandatoryCashUsd: optNum(0, 1_000_000),
    comparableCashUsd: optNum(0, 10_000_000),
    comparableCashSource: z.enum(CASH_SOURCES).default('owner_observed'),
    alternativeCashUsd: optNum(0, 10_000_000),
    travelStart: isoDate,
    travelEnd: isoDate,
    nights: optInt(0, 365),
    flexibleDates: bool.default(false),
    // Flight
    cabin: z.preprocess(emptyToNull, z.enum(CABINS).nullable()),
    seatType: z.preprocess(emptyToNull, z.enum(SEAT_TYPES).nullable()),
    operatingAirline: optText(120),
    flightNumbers: list(8),
    aircraft: optText(120),
    stops: optInt(0, 6),
    durationMinutes: optInt(0, 72 * 60),
    connectionMinutes: list(6),
    mixedCabin: optBool,
    directAisleAccess: optBool,
    overnightLayover: optBool,
    separateTickets: optBool,
    aircraftVerified: bool.default(false),
    // Hotel
    property: optText(200),
    roomCategory: optText(200),
    roomType: z.preprocess(emptyToNull, z.enum(ROOM_TYPES).nullable()),
    guests: optInt(1, 12),
    meals: optText(120),
    cancellation: optText(200),
    resortFeeUsd: optNum(0, 100_000),
    mandatoryTransfer: optText(200),
    programCategory: optText(60),
    isStandardAward: optBool,
    roomVerified: bool.default(false),
    // What the cash price describes
    cashCabin: z.preprocess(emptyToNull, z.enum(CABINS).nullable()),
    cashSeatType: z.preprocess(emptyToNull, z.enum(SEAT_TYPES).nullable()),
    cashRoomType: z.preprocess(emptyToNull, z.enum(ROOM_TYPES).nullable()),
    cashRefundable: optBool,
    cashMealsIncluded: optBool,
    // Evidence
    tags: list(12).transform((t) => t.filter((x): x is (typeof TRAVEL_TAGS)[number] => (TRAVEL_TAGS as readonly string[]).includes(x))),
    sourceName: optText(120),
    sourceUrl: httpUrl,
    bookingUrl: httpUrl,
    imageUrl: httpUrl,
    availability: z.enum(AVAILABILITY).default('unknown'),
    verifiedNow: bool.default(false),
    deadlineType: z.enum(['confirmed', 'observed', 'estimated', 'none']).default('none'),
    deadlineAt: z.preprocess(emptyToNull, z.coerce.date().nullable()),
    deadlineTimezone: optText(60),
    deadlineSource: optText(300),
    whyNoteworthy: optText(600),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'flight' && !v.cabin) ctx.addIssue({ code: 'custom', path: ['cabin'], message: 'Cabin is required for flights' })
    if ((v.kind === 'hotel' || v.kind === 'package') && !v.property) {
      ctx.addIssue({ code: 'custom', path: ['property'], message: 'Property name is required for hotels' })
    }
    if (v.travelStart && v.travelEnd && v.travelEnd < v.travelStart) {
      ctx.addIssue({ code: 'custom', path: ['travelEnd'], message: 'End date is before start date' })
    }
    if (v.deadlineType === 'confirmed' && !v.deadlineAt) {
      ctx.addIssue({ code: 'custom', path: ['deadlineAt'], message: 'A confirmed deadline needs a date and time' })
    }
    if (v.deadlineType === 'confirmed' && !v.deadlineSource) {
      ctx.addIssue({ code: 'custom', path: ['deadlineSource'], message: 'Say where the deadline is documented' })
    }
    if (!v.destAirport && !v.destCountryCode && !v.destCountry) {
      ctx.addIssue({ code: 'custom', path: ['destCountry'], message: 'Enter a destination airport or country' })
    }
  })

export type ManualDealInput = z.infer<typeof manualDealSchema>

function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/** Natural key so the same opportunity is stored once, regardless of who reported it. */
export function dealDedupeKey(v: Pick<ManualDealInput, 'kind' | 'programId' | 'originAirport' | 'destAirport' | 'destCity' | 'travelStart' | 'travelEnd' | 'cabin' | 'flightNumbers' | 'property' | 'roomType'>): string {
  if (v.kind === 'flight') {
    return ['f', norm(v.programId), v.originAirport ?? '', v.destAirport ?? norm(v.destCity), v.travelStart ?? 'flex', v.cabin ?? '', v.flightNumbers.map(norm).join('+')].join(':')
  }
  return [v.kind === 'hotel' ? 'h' : 'p', norm(v.programId), norm(v.property ?? v.destCity), v.travelStart ?? 'flex', v.travelEnd ?? '', v.roomType ?? ''].join(':')
}

export interface DealColumns {
  dedupeKey: string
  kind: ManualDealInput['kind']
  title: string
  destCity: string
  destCountry: string
  destCountryCode: string | null
  destRegion: Region
  destAirport: string | null
  destLat: number | null
  destLon: number | null
  originAirport: string | null
  providerName: string
  programId: string
  programPoints: number | null
  mandatoryCashUsd: number | null
  comparableCashUsd: number | null
  comparableCashSource: string
  comparableCashObservedAt: Date | null
  alternativeCashUsd: number | null
  travelStart: string | null
  travelEnd: string | null
  nights: number | null
  flexibleDates: boolean
  flight: FlightDetails | null
  hotel: HotelDetails | null
  cashProduct: CashProduct | null
  tags: string[]
  sourceName: string
  sourceUrl: string | null
  bookingUrl: string | null
  imageUrl: string | null
  availability: string
  missingInfo: string[]
  deadlineType: string
  deadlineAt: Date | null
  deadlineTimezone: string | null
  deadlineSource: string | null
  whyNoteworthy: string | null
}

function nightsBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

/** Converts validated input into database columns, deriving geography and listing missing information. */
export function toDealColumns(v: ManualDealInput, now: Date): DealColumns {
  const airport = getAirport(v.destAirport)
  const cc = v.destCountryCode ?? airport?.countryCode ?? null
  const country = v.destCountry ?? airport?.countryName ?? cc ?? ''
  const region: Region = airport?.region ?? (cc ? regionForCountryCode(cc) : 'north_america')
  const nights = v.nights ?? (v.travelStart && v.travelEnd && v.kind !== 'flight' ? nightsBetween(v.travelStart, v.travelEnd) : null)

  const flight: FlightDetails | null =
    v.kind === 'flight' && v.cabin
      ? {
          cabin: v.cabin,
          seatType: v.seatType ?? 'unknown',
          operatingAirline: v.operatingAirline,
          flightNumbers: v.flightNumbers,
          aircraft: v.aircraft,
          stops: v.stops,
          connectionMinutes: v.connectionMinutes.map(Number).filter((n) => Number.isFinite(n) && n >= 0),
          durationMinutes: v.durationMinutes,
          mixedCabin: v.mixedCabin,
          directAisleAccess: v.directAisleAccess,
          overnightLayover: v.overnightLayover,
          separateTickets: v.separateTickets,
          aircraftVerified: v.aircraftVerified,
        }
      : null
  const hotel: HotelDetails | null =
    (v.kind === 'hotel' || v.kind === 'package') && v.property
      ? {
          property: v.property,
          roomCategory: v.roomCategory,
          roomType: v.roomType ?? 'unknown',
          guests: v.guests,
          meals: v.meals,
          cancellation: v.cancellation,
          resortFeeUsd: v.resortFeeUsd,
          mandatoryTransfer: v.mandatoryTransfer,
          isStandardAward: v.isStandardAward,
          programCategory: v.programCategory,
          roomVerified: v.roomVerified,
        }
      : null
  const cashProduct: CashProduct | null =
    v.comparableCashUsd == null
      ? null
      : v.kind === 'flight'
        ? {
            cabin: v.cashCabin ?? v.cabin,
            seatType: v.cashSeatType ?? null,
            origin: v.originAirport,
            destination: v.destAirport,
            date: v.travelStart,
            refundable: v.cashRefundable,
          }
        : {
            property: v.property,
            roomType: v.cashRoomType ?? null,
            guests: v.guests,
            mealsIncluded: v.cashMealsIncluded,
            checkIn: v.travelStart,
            checkOut: v.travelEnd,
          }

  const missing: string[] = []
  if (v.programPoints == null) missing.push('Points price')
  if (v.mandatoryCashUsd == null) missing.push('Taxes and fees')
  if (v.comparableCashUsd == null) missing.push('Comparable cash price')
  if (!v.travelStart) missing.push('Travel dates')
  if (flight && flight.seatType === 'unknown' && (flight.cabin === 'business' || flight.cabin === 'first')) missing.push('Seat type')
  if (flight && !flight.aircraft) missing.push('Aircraft')
  if (hotel && hotel.roomType === 'unknown') missing.push('Room type')

  const title =
    v.title ??
    (v.kind === 'flight' ? `${v.providerName} — ${v.cabin ? v.cabin.replace('_', ' ') : ''} to ${v.destCity}`.replace(/\s+/g, ' ') : `${v.property ?? v.providerName} — ${v.destCity}`)

  return {
    dedupeKey: dealDedupeKey(v),
    kind: v.kind,
    title,
    destCity: v.destCity,
    destCountry: country,
    destCountryCode: cc,
    destRegion: region,
    destAirport: v.destAirport,
    destLat: airport?.lat ?? null,
    destLon: airport?.lon ?? null,
    originAirport: v.originAirport,
    providerName: v.providerName,
    programId: v.programId,
    programPoints: v.programPoints,
    mandatoryCashUsd: v.mandatoryCashUsd,
    comparableCashUsd: v.comparableCashUsd,
    comparableCashSource: v.comparableCashSource,
    comparableCashObservedAt: v.comparableCashUsd != null ? now : null,
    alternativeCashUsd: v.alternativeCashUsd,
    travelStart: v.travelStart,
    travelEnd: v.travelEnd,
    nights,
    flexibleDates: v.flexibleDates,
    flight,
    hotel,
    cashProduct,
    tags: v.tags,
    sourceName: v.sourceName ?? 'Entered manually',
    sourceUrl: v.sourceUrl,
    bookingUrl: v.bookingUrl,
    imageUrl: v.imageUrl,
    availability: v.availability,
    missingInfo: missing,
    deadlineType: v.deadlineType,
    deadlineAt: v.deadlineType === 'confirmed' ? v.deadlineAt : null,
    deadlineTimezone: v.deadlineTimezone,
    deadlineSource: v.deadlineSource,
    whyNoteworthy: v.whyNoteworthy,
  }
}

/** Parses a small CSV file (header row + values; quoted fields supported). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else q = false
      } else field += ch
    } else if (ch === '"') q = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (ch !== '\r') field += ch
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  const [header, ...body] = rows.filter((r) => r.some((c) => c.trim() !== ''))
  if (!header) return []
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ''])))
}

/** Flat form values for editing an existing deal (inverse of toDealColumns). */
export function dealToFormValues(d: import('../domain/types').Deal): Record<string, string> {
  const s = (v: unknown) => (v == null ? '' : String(v))
  const b = (v: boolean | null | undefined) => (v ? 'on' : '')
  return {
    kind: d.kind,
    title: d.title,
    destCity: d.destination.city,
    destCountry: d.destination.country,
    destCountryCode: s(d.destination.countryCode),
    destAirport: s(d.destination.airport),
    originAirport: s(d.originAirport),
    providerName: d.providerName,
    programId: s(d.programId),
    programPoints: s(d.programPoints),
    mandatoryCashUsd: s(d.mandatoryCashUsd),
    comparableCashUsd: s(d.comparableCashUsd),
    comparableCashSource: d.comparableCashSource,
    alternativeCashUsd: s(d.alternativeCashUsd),
    travelStart: s(d.travelStart),
    travelEnd: s(d.travelEnd),
    nights: s(d.nights),
    flexibleDates: b(d.flexibleDates),
    cabin: s(d.flight?.cabin),
    seatType: s(d.flight?.seatType),
    operatingAirline: s(d.flight?.operatingAirline),
    flightNumbers: d.flight?.flightNumbers.join(', ') ?? '',
    aircraft: s(d.flight?.aircraft),
    stops: s(d.flight?.stops),
    durationMinutes: s(d.flight?.durationMinutes),
    connectionMinutes: d.flight?.connectionMinutes.join(', ') ?? '',
    mixedCabin: b(d.flight?.mixedCabin),
    directAisleAccess: b(d.flight?.directAisleAccess),
    overnightLayover: b(d.flight?.overnightLayover),
    separateTickets: b(d.flight?.separateTickets),
    aircraftVerified: b(d.flight?.aircraftVerified),
    property: s(d.hotel?.property),
    roomCategory: s(d.hotel?.roomCategory),
    roomType: s(d.hotel?.roomType),
    guests: s(d.hotel?.guests),
    meals: s(d.hotel?.meals),
    cancellation: s(d.hotel?.cancellation),
    resortFeeUsd: s(d.hotel?.resortFeeUsd),
    mandatoryTransfer: s(d.hotel?.mandatoryTransfer),
    programCategory: s(d.hotel?.programCategory),
    isStandardAward: b(d.hotel?.isStandardAward),
    roomVerified: b(d.hotel?.roomVerified),
    cashCabin: s(d.cashProduct?.cabin),
    cashSeatType: s(d.cashProduct?.seatType),
    cashRoomType: s(d.cashProduct?.roomType),
    cashRefundable: b(d.cashProduct?.refundable),
    cashMealsIncluded: b(d.cashProduct?.mealsIncluded),
    tags: d.tags.join(','),
    sourceName: d.sourceName,
    sourceUrl: s(d.sourceUrl),
    bookingUrl: s(d.bookingUrl),
    imageUrl: s(d.imageUrl),
    availability: d.availability,
    deadlineType: d.deadline.type,
    deadlineAt: '',
    deadlineTimezone: s(d.deadline.timezone),
    deadlineSource: s(d.deadline.source),
    whyNoteworthy: s(d.whyNoteworthy),
  }
}
