import { z } from 'zod'
import {
  AVAILABILITY,
  CABINS,
  CARD_TYPE_IDS,
  CASH_SOURCES,
  DEADLINE_TYPES,
  DEAL_KINDS,
  REGIONS,
  ROOM_TYPES,
  SEAT_TYPES,
  SOURCE_KINDS,
  type Availability,
  type CardType,
  type CashSource,
  type DeadlineType,
  type DealKind,
  type Region,
  type SourceKind,
} from './constants'

export const flightDetailsSchema = z.object({
  cabin: z.enum(CABINS),
  seatType: z.enum(SEAT_TYPES).default('unknown'),
  operatingAirline: z.string().max(120).nullish(),
  flightNumbers: z.array(z.string().max(12)).max(8).default([]),
  aircraft: z.string().max(120).nullish(),
  stops: z.number().int().min(0).max(6).nullish(),
  connectionMinutes: z.array(z.number().int().min(0).max(48 * 60)).max(6).default([]),
  durationMinutes: z.number().int().min(0).max(72 * 60).nullish(),
  mixedCabin: z.boolean().nullish(),
  directAisleAccess: z.boolean().nullish(),
  overnightLayover: z.boolean().nullish(),
  separateTickets: z.boolean().nullish(),
  /** True when aircraft/seat were confirmed against an authoritative source. */
  aircraftVerified: z.boolean().default(false),
})
export type FlightDetails = z.infer<typeof flightDetailsSchema>

export const hotelDetailsSchema = z.object({
  property: z.string().min(1).max(200),
  roomCategory: z.string().max(200).nullish(),
  roomType: z.enum(ROOM_TYPES).default('unknown'),
  guests: z.number().int().min(1).max(12).nullish(),
  meals: z.string().max(120).nullish(),
  cancellation: z.string().max(200).nullish(),
  resortFeeUsd: z.number().min(0).max(100000).nullish(),
  mandatoryTransfer: z.string().max(200).nullish(),
  mandatoryTransferUsd: z.number().min(0).max(100000).nullish(),
  isStandardAward: z.boolean().nullish(),
  /** Hotel class / program category as text (e.g. "Category 7"). */
  programCategory: z.string().max(60).nullish(),
  roomVerified: z.boolean().default(false),
})
export type HotelDetails = z.infer<typeof hotelDetailsSchema>

/** Describes the product the comparable cash price was observed for. */
export const cashProductSchema = z.object({
  cabin: z.enum(CABINS).nullish(),
  seatType: z.enum(SEAT_TYPES).nullish(),
  origin: z.string().max(3).nullish(),
  destination: z.string().max(3).nullish(),
  date: z.string().nullish(),
  stops: z.number().int().min(0).max(6).nullish(),
  refundable: z.boolean().nullish(),
  property: z.string().max(200).nullish(),
  roomType: z.enum(ROOM_TYPES).nullish(),
  guests: z.number().int().min(1).max(12).nullish(),
  mealsIncluded: z.boolean().nullish(),
  checkIn: z.string().nullish(),
  checkOut: z.string().nullish(),
})
export type CashProduct = z.infer<typeof cashProductSchema>

export interface Destination {
  city: string
  country: string
  countryCode: string | null
  region: Region
  airport: string | null
  lat: number | null
  lon: number | null
}

export interface DealDeadline {
  at: Date | null
  type: DeadlineType
  source: string | null
  timezone: string | null
}

/** Engine-facing representation of a deal (mapped from the database row). */
export interface Deal {
  id: string
  kind: DealKind
  title: string
  destination: Destination
  originAirport: string | null
  providerName: string
  programId: string | null
  programPoints: number | null
  mandatoryCashUsd: number | null
  comparableCashUsd: number | null
  comparableCashSource: CashSource
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
  sourceKind: SourceKind
  sourceName: string
  sourceUrl: string | null
  collectedAt: Date
  lastVerifiedAt: Date | null
  verificationMethod: string | null
  availability: Availability
  missingInfo: string[]
  deadline: DealDeadline
  whyNoteworthy: string | null
  imageUrl: string | null
  imageCredit: string | null
  bookingUrl: string | null
  /** Illustrative transfer bonus used only by demo deals. Never applied to real deals. */
  assumedBonusPercent: number | null
  archivedAt: Date | null
  archiveReason: string | null
  firstSeenAt: Date
  lastSeenAt: Date
}

export interface TransferRatio {
  chase: number
  partner: number
}

export interface TransferPartner {
  id: string
  name: string
  programName: string
  type: 'airline' | 'hotel'
  alliance: string | null
  baseRatio: TransferRatio
  cardRatioOverrides: Partial<Record<CardType, TransferRatio>>
  minTransfer: number
  transferIncrement: number
  bonusRounding: 'floor' | 'round' | 'ceil'
  processingTime: string
  restrictions: string | null
  bookingLimitations: string | null
  transferInstructions: string | null
  programUrl: string | null
  sourceUrls: string[]
  lastVerifiedAt: Date | null
  verificationStatus: 'official_verified' | 'research_seed' | 'owner_verified' | 'stale'
  active: boolean
  notes: string | null
}

export interface TransferPromotion {
  id: string
  partnerId: string
  bonusPercent: number
  startsAt: Date
  endsAt: Date | null
  endsAtTimezone: string | null
  eligibleCardTypes: CardType[] | null
  isTargeted: boolean
  eligibility: string | null
  sourceUrl: string | null
  sourceKind: 'official' | 'announcement' | 'manual'
  verificationStatus: 'official_verified' | 'reported' | 'owner_verified'
  lastVerifiedAt: Date | null
  notes: string | null
}

// Zod enums re-exported for validation in forms and adapters.
export const zCardType = z.enum(CARD_TYPE_IDS)
export const zDealKind = z.enum(DEAL_KINDS)
export const zSourceKind = z.enum(SOURCE_KINDS)
export const zCashSource = z.enum(CASH_SOURCES)
export const zAvailability = z.enum(AVAILABILITY)
export const zDeadlineType = z.enum(DEADLINE_TYPES)
export const zRegion = z.enum(REGIONS)
