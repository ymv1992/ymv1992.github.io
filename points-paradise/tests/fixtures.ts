/**
 * TEST FIXTURES ONLY. Deterministic data for unit tests. These records are
 * never loaded into the application database and are not real deals.
 */
import type { Deal, TransferPartner, TransferPromotion } from '@/lib/domain/types'
import type { ProfilePreferences } from '@/lib/engine/personalization'
import type { EvaluationContext } from '@/lib/engine/evaluate'

export const NOW = new Date('2026-10-18T12:00:00Z')

export function partner(overrides: Partial<TransferPartner> = {}): TransferPartner {
  return {
    id: 'test_air',
    name: 'Test Airline',
    programName: 'Test Miles',
    type: 'airline',
    alliance: null,
    baseRatio: { chase: 1, partner: 1 },
    cardRatioOverrides: {},
    minTransfer: 1000,
    transferIncrement: 1000,
    bonusRounding: 'floor',
    processingTime: 'Instant (test)',
    restrictions: null,
    bookingLimitations: null,
    transferInstructions: null,
    programUrl: 'https://example.com/test-air',
    sourceUrls: [],
    lastVerifiedAt: NOW,
    verificationStatus: 'official_verified',
    active: true,
    notes: null,
    ...overrides,
  }
}

export const testHotelPartner = partner({
  id: 'test_hotel',
  name: 'Test Hotels',
  programName: 'Test Hotel Points',
  type: 'hotel',
  cardRatioOverrides: { sapphire_preferred: { chase: 4, partner: 3 } },
})

export function partnersMap(...ps: TransferPartner[]): Map<string, TransferPartner> {
  return new Map(ps.map((p) => [p.id, p]))
}

export function promo(overrides: Partial<TransferPromotion> = {}): TransferPromotion {
  return {
    id: 'promo-test',
    partnerId: 'test_air',
    bonusPercent: 25,
    startsAt: new Date('2026-10-01T00:00:00Z'),
    endsAt: new Date('2026-10-31T23:59:59Z'),
    endsAtTimezone: 'America/New_York',
    eligibleCardTypes: null,
    isTargeted: false,
    eligibility: null,
    sourceUrl: null,
    sourceKind: 'official',
    verificationStatus: 'official_verified',
    lastVerifiedAt: NOW,
    notes: null,
    ...overrides,
  }
}

let seq = 0
export function flightDeal(overrides: Partial<Deal> = {}): Deal {
  seq++
  return {
    id: `test-flight-${seq}`,
    kind: 'flight',
    title: 'Test flight',
    destination: { city: 'Tokyo', country: 'Japan', countryCode: 'JP', region: 'asia', airport: 'HND', lat: 35.5, lon: 139.8 },
    originAirport: 'LAX',
    providerName: 'Test Airline',
    programId: 'test_air',
    programPoints: 75_000,
    mandatoryCashUsd: 180,
    comparableCashUsd: 5_200,
    comparableCashSource: 'owner_observed',
    comparableCashObservedAt: NOW,
    alternativeCashUsd: null,
    travelStart: '2026-12-01',
    travelEnd: null,
    nights: null,
    flexibleDates: false,
    flight: {
      cabin: 'business',
      seatType: 'lie_flat',
      operatingAirline: 'Test Airline',
      flightNumbers: ['TA1'],
      aircraft: 'Test 787',
      stops: 0,
      connectionMinutes: [],
      durationMinutes: 11 * 60,
      mixedCabin: false,
      directAisleAccess: true,
      overnightLayover: false,
      separateTickets: false,
      aircraftVerified: true,
    },
    hotel: null,
    cashProduct: { cabin: 'business', seatType: 'lie_flat', origin: 'LAX', destination: 'HND', date: '2026-12-01', stops: 0 },
    tags: ['city', 'culture', 'food'],
    sourceKind: 'manual',
    sourceName: 'Test',
    sourceUrl: null,
    collectedAt: NOW,
    lastVerifiedAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    verificationMethod: 'owner_check',
    availability: 'available',
    missingInfo: [],
    deadline: { at: null, type: 'observed', source: null, timezone: null },
    whyNoteworthy: null,
    imageUrl: null,
    imageCredit: null,
    bookingUrl: null,
    assumedBonusPercent: null,
    archivedAt: null,
    archiveReason: null,
    firstSeenAt: NOW,
    lastSeenAt: NOW,
    ...overrides,
  }
}

export function hotelDeal(overrides: Partial<Deal> = {}): Deal {
  return flightDeal({
    kind: 'hotel',
    title: 'Test resort',
    destination: { city: 'Malé', country: 'Maldives', countryCode: 'MV', region: 'indian_ocean', airport: 'MLE', lat: 4.19, lon: 73.5 },
    originAirport: null,
    providerName: 'Test Resort',
    programId: 'test_hotel',
    programPoints: 120_000,
    mandatoryCashUsd: 300,
    comparableCashUsd: 6_000,
    travelStart: '2026-12-02',
    travelEnd: '2026-12-06',
    nights: 4,
    flight: null,
    hotel: {
      property: 'Test Resort Maldives',
      roomCategory: 'Beach villa',
      roomType: 'villa',
      guests: 2,
      meals: null,
      cancellation: null,
      resortFeeUsd: null,
      mandatoryTransfer: 'Seaplane',
      mandatoryTransferUsd: null,
      isStandardAward: true,
      programCategory: 'Category 7',
      roomVerified: true,
    },
    cashProduct: { property: 'Test Resort Maldives', roomType: 'villa', guests: 2, checkIn: '2026-12-02', checkOut: '2026-12-06' },
    tags: ['beach', 'island', 'luxury', 'romantic'],
    ...overrides,
  })
}

export const neutralProfile: ProfilePreferences = {
  tagPreferences: {},
  learnedWeights: {},
  tripNightsMin: null,
  tripNightsMax: null,
  maxFlightHours: null,
  dateFlexibility: 'few_weeks',
  visited: [],
  dreamDestinations: [],
  dealBreakers: [],
  preferredCategories: [],
  preferNewPlaces: true,
}

export function evalCtx(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    now: NOW,
    card: 'sapphire_reserve',
    partners: partnersMap(partner(), testHotelPartner),
    promotions: [],
    pointFloorCents: 1,
    pointsBalance: 150_000,
    maxCashUsd: 1_000,
    profile: neutralProfile,
    displayTimeZone: 'America/Los_Angeles',
    ...overrides,
  }
}
