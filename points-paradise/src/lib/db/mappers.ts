import type { InferSelectModel } from 'drizzle-orm'
import { cashProductSchema, flightDetailsSchema, hotelDetailsSchema, type Deal, type TransferPartner, type TransferPromotion } from '../domain/types'
import type { CardType, DateFlexibility, DealBreaker, Region, CategorySlug, TravelTag } from '../domain/constants'
import type { ProfilePreferences, TagPreference } from '../engine/personalization'
import type { deals, transferPartners, transferPromotions, travelProfiles } from './schema'

export type DealRow = InferSelectModel<typeof deals>
export type PartnerRow = InferSelectModel<typeof transferPartners>
export type PromotionRow = InferSelectModel<typeof transferPromotions>
export type ProfileRow = InferSelectModel<typeof travelProfiles>

/** Parses JSON columns defensively: malformed data becomes null rather than crashing a page. */
function parseOrNull<T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }, value: unknown): T | null {
  if (value == null) return null
  const r = schema.safeParse(value)
  return r.success ? (r.data as T) : null
}

export function dealFromRow(r: DealRow): Deal {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    destination: {
      city: r.destCity,
      country: r.destCountry,
      countryCode: r.destCountryCode,
      region: r.destRegion as Region,
      airport: r.destAirport,
      lat: r.destLat,
      lon: r.destLon,
    },
    originAirport: r.originAirport,
    providerName: r.providerName,
    programId: r.programId,
    programPoints: r.programPoints,
    mandatoryCashUsd: r.mandatoryCashUsd,
    comparableCashUsd: r.comparableCashUsd,
    comparableCashSource: r.comparableCashSource as Deal['comparableCashSource'],
    comparableCashObservedAt: r.comparableCashObservedAt,
    alternativeCashUsd: r.alternativeCashUsd,
    travelStart: r.travelStart,
    travelEnd: r.travelEnd,
    nights: r.nights,
    flexibleDates: r.flexibleDates,
    flight: parseOrNull(flightDetailsSchema, r.flight),
    hotel: parseOrNull(hotelDetailsSchema, r.hotel),
    cashProduct: parseOrNull(cashProductSchema, r.cashProduct),
    tags: r.tags,
    sourceKind: r.sourceKind as Deal['sourceKind'],
    sourceName: r.sourceName,
    sourceUrl: r.sourceUrl,
    collectedAt: r.collectedAt,
    lastVerifiedAt: r.lastVerifiedAt,
    verificationMethod: r.verificationMethod,
    availability: r.availability as Deal['availability'],
    missingInfo: r.missingInfo,
    deadline: {
      at: r.deadlineAt,
      type: r.deadlineType as Deal['deadline']['type'],
      source: r.deadlineSource,
      timezone: r.deadlineTimezone,
    },
    whyNoteworthy: r.whyNoteworthy,
    imageUrl: r.imageUrl,
    imageCredit: r.imageCredit,
    bookingUrl: r.bookingUrl,
    assumedBonusPercent: r.assumedBonusPercent,
    archivedAt: r.archivedAt,
    archiveReason: r.archiveReason,
    firstSeenAt: r.firstSeenAt,
    lastSeenAt: r.lastSeenAt,
  }
}

export function partnerFromRow(r: PartnerRow): TransferPartner {
  return {
    id: r.id,
    name: r.name,
    programName: r.programName,
    type: r.type,
    alliance: r.alliance,
    baseRatio: { chase: r.baseRatioChase, partner: r.baseRatioPartner },
    cardRatioOverrides: r.cardRatioOverrides as TransferPartner['cardRatioOverrides'],
    minTransfer: r.minTransfer,
    transferIncrement: r.transferIncrement,
    bonusRounding: r.bonusRounding,
    processingTime: r.processingTime,
    restrictions: r.restrictions,
    bookingLimitations: r.bookingLimitations,
    transferInstructions: r.transferInstructions,
    programUrl: r.programUrl,
    sourceUrls: r.sourceUrls,
    lastVerifiedAt: r.lastVerifiedAt,
    verificationStatus: r.verificationStatus,
    active: r.active,
    notes: r.notes,
  }
}

export function promotionFromRow(r: PromotionRow): TransferPromotion {
  return {
    id: r.id,
    partnerId: r.partnerId,
    bonusPercent: r.bonusPercent,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    endsAtTimezone: r.endsAtTimezone,
    eligibleCardTypes: (r.eligibleCardTypes as CardType[] | null) ?? null,
    isTargeted: r.isTargeted,
    eligibility: r.eligibility,
    sourceUrl: r.sourceUrl,
    sourceKind: r.sourceKind,
    verificationStatus: r.verificationStatus,
    lastVerifiedAt: r.lastVerifiedAt,
    notes: r.notes,
  }
}

export function preferencesFromProfile(p: ProfileRow): ProfilePreferences {
  return {
    tagPreferences: p.tagPreferences as Partial<Record<TravelTag, TagPreference>>,
    learnedWeights: p.learnedWeights,
    tripNightsMin: p.tripNightsMin,
    tripNightsMax: p.tripNightsMax,
    maxFlightHours: p.maxFlightHours,
    dateFlexibility: p.dateFlexibility as DateFlexibility,
    visited: p.visited,
    dreamDestinations: p.dreamDestinations,
    dealBreakers: p.dealBreakers as DealBreaker[],
    preferredCategories: p.preferredCategories as CategorySlug[],
    preferNewPlaces: p.preferNewPlaces,
  }
}
