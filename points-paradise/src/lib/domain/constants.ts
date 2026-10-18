/**
 * Shared vocabulary for the whole app. Everything here is static product
 * configuration; nothing in this file is live travel data.
 */

export const CARD_TYPES = [
  { id: 'sapphire_reserve', label: 'Chase Sapphire Reserve', canTransfer: true },
  { id: 'sapphire_reserve_business', label: 'Chase Sapphire Reserve for Business', canTransfer: true },
  { id: 'sapphire_preferred', label: 'Chase Sapphire Preferred', canTransfer: true },
  { id: 'ink_business_preferred', label: 'Ink Business Preferred', canTransfer: true },
  { id: 'ink_plus', label: 'Ink Plus (legacy)', canTransfer: true },
  { id: 'freedom_unlimited', label: 'Freedom Unlimited', canTransfer: false },
  { id: 'freedom_flex', label: 'Freedom Flex', canTransfer: false },
  { id: 'freedom', label: 'Freedom (legacy)', canTransfer: false },
  { id: 'ink_business_cash', label: 'Ink Business Cash', canTransfer: false },
  { id: 'ink_business_unlimited', label: 'Ink Business Unlimited', canTransfer: false },
  { id: 'other', label: 'Other / not sure', canTransfer: false },
] as const

export type CardType = (typeof CARD_TYPES)[number]['id']
export const CARD_TYPE_IDS = CARD_TYPES.map((c) => c.id) as [CardType, ...CardType[]]

export function cardCanTransfer(card: CardType): boolean {
  return CARD_TYPES.find((c) => c.id === card)?.canTransfer ?? false
}

export function cardLabel(card: CardType): string {
  return CARD_TYPES.find((c) => c.id === card)?.label ?? card
}

export const CABINS = ['economy', 'premium_economy', 'business', 'first'] as const
export type Cabin = (typeof CABINS)[number]
export const CABIN_LABELS: Record<Cabin, string> = {
  economy: 'Economy',
  premium_economy: 'Premium economy',
  business: 'Business',
  first: 'First',
}

export const SEAT_TYPES = ['suite', 'lie_flat', 'angled_flat', 'recliner', 'standard', 'unknown'] as const
export type SeatType = (typeof SEAT_TYPES)[number]
export const SEAT_TYPE_LABELS: Record<SeatType, string> = {
  suite: 'Enclosed suite',
  lie_flat: 'Lie-flat',
  angled_flat: 'Angled-flat',
  recliner: 'Recliner',
  standard: 'Standard seat',
  unknown: 'Not verified',
}
/** Rough product quality order used to detect unequal comparisons. */
export const SEAT_TYPE_RANK: Record<SeatType, number> = {
  standard: 0,
  recliner: 1,
  angled_flat: 2,
  lie_flat: 3,
  suite: 4,
  unknown: -1,
}

export const ROOM_TYPES = ['standard', 'premium', 'suite', 'villa', 'pool_villa', 'overwater_villa', 'unknown'] as const
export type RoomType = (typeof ROOM_TYPES)[number]
export const ROOM_TYPE_LABELS: Record<RoomType, string> = {
  standard: 'Standard room',
  premium: 'Premium / view room',
  suite: 'Suite',
  villa: 'Villa',
  pool_villa: 'Pool villa',
  overwater_villa: 'Overwater villa',
  unknown: 'Not verified',
}
export const ROOM_TYPE_RANK: Record<RoomType, number> = {
  standard: 0,
  premium: 1,
  suite: 2,
  villa: 3,
  pool_villa: 4,
  overwater_villa: 5,
  unknown: -1,
}

export const DEAL_KINDS = ['flight', 'hotel', 'package', 'experience'] as const
export type DealKind = (typeof DEAL_KINDS)[number]

export const SOURCE_KINDS = ['api', 'manual', 'announcement', 'research', 'demo', 'prediction'] as const
export type SourceKind = (typeof SOURCE_KINDS)[number]
export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  api: 'Data provider',
  manual: 'Entered by you',
  announcement: 'Public announcement',
  research: 'Research lead',
  demo: 'Demo (fictional)',
  prediction: 'Statistical prediction',
}

export const CASH_SOURCES = ['live_api', 'owner_observed', 'published_fare', 'rack_rate', 'estimate', 'unknown'] as const
export type CashSource = (typeof CASH_SOURCES)[number]
export const CASH_SOURCE_LABELS: Record<CashSource, string> = {
  live_api: 'Live fare/rate API',
  owner_observed: 'Observed by you on an official site',
  published_fare: 'Published fare (third party)',
  rack_rate: 'Advertised rack rate',
  estimate: 'Estimate',
  unknown: 'Unknown source',
}

export const AVAILABILITY = ['available', 'unavailable', 'unknown'] as const
export type Availability = (typeof AVAILABILITY)[number]

export const DEADLINE_TYPES = ['confirmed', 'observed', 'estimated', 'none'] as const
export type DeadlineType = (typeof DEADLINE_TYPES)[number]

/** Evidence tiers, ordered from strongest to weakest. */
export const EVIDENCE_STATUSES = [
  'verified_live',
  'recently_verified',
  'cached',
  'unverified_lead',
  'prediction',
  'demo',
  'unavailable',
  'expired',
] as const
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number]
export const EVIDENCE_LABELS: Record<EvidenceStatus, string> = {
  verified_live: 'Verified live',
  recently_verified: 'Recently verified',
  cached: 'Cached result',
  unverified_lead: 'Unverified lead',
  prediction: 'Prediction',
  demo: 'Demo — fictional',
  unavailable: 'No longer available',
  expired: 'Expired',
}

export const TRAVEL_TAGS = [
  'beach',
  'island',
  'overwater',
  'private_pool',
  'mountains',
  'snow',
  'desert',
  'wildlife',
  'safari',
  'culture',
  'city',
  'food',
  'romantic',
  'adventure',
  'wellness',
  'hidden_gem',
  'luxury',
  'unique_stay',
  'scenic',
  'photography',
  'family',
  'solo',
  'nightlife',
] as const
export type TravelTag = (typeof TRAVEL_TAGS)[number]
export const TAG_LABELS: Record<TravelTag, string> = {
  beach: 'Beaches',
  island: 'Islands',
  overwater: 'Overwater villas',
  private_pool: 'Private pools',
  mountains: 'Mountains',
  snow: 'Snow',
  desert: 'Deserts',
  wildlife: 'Wildlife',
  safari: 'Safari',
  culture: 'Culture',
  city: 'Cities',
  food: 'Food',
  romantic: 'Romantic',
  adventure: 'Adventure',
  wellness: 'Wellness',
  hidden_gem: 'Hidden gems',
  luxury: 'Luxury hotels',
  unique_stay: 'Unique stays',
  scenic: 'Scenic landscapes',
  photography: 'Photography',
  family: 'Family',
  solo: 'Solo travel',
  nightlife: 'Nightlife',
}

export const REGIONS = [
  'north_america',
  'mexico_central_america',
  'caribbean',
  'south_america',
  'europe',
  'middle_east',
  'africa',
  'indian_ocean',
  'asia',
  'oceania',
  'south_pacific',
  'antarctica',
] as const
export type Region = (typeof REGIONS)[number]
export const REGION_LABELS: Record<Region, string> = {
  north_america: 'North America',
  mexico_central_america: 'Mexico & Central America',
  caribbean: 'Caribbean',
  south_america: 'South America',
  europe: 'Europe',
  middle_east: 'Middle East',
  africa: 'Africa',
  indian_ocean: 'Indian Ocean',
  asia: 'Asia',
  oceania: 'Australia & New Zealand',
  south_pacific: 'South Pacific',
  antarctica: 'Antarctica',
}

export const DATE_FLEXIBILITY = ['fixed', 'few_days', 'few_weeks', 'anytime'] as const
export type DateFlexibility = (typeof DATE_FLEXIBILITY)[number]
export const DATE_FLEXIBILITY_LABELS: Record<DateFlexibility, string> = {
  fixed: 'Fixed dates',
  few_days: '± a few days',
  few_weeks: 'Within a few weeks',
  anytime: 'Any time it is worth it',
}

export const DEAL_BREAKERS = [
  'no_connections',
  'no_recliner_long_haul',
  'no_overnight_layovers',
  'no_separate_tickets',
  'no_positioning',
] as const
export type DealBreaker = (typeof DEAL_BREAKERS)[number]
export const DEAL_BREAKER_LABELS: Record<DealBreaker, string> = {
  no_connections: 'Nonstop flights only',
  no_recliner_long_haul: 'No recliner seats on long-haul premium flights',
  no_overnight_layovers: 'No overnight layovers',
  no_separate_tickets: 'No separate-ticket connections',
  no_positioning: 'No positioning flights',
}

export const CATEGORY_DEFS = [
  { slug: 'business', label: 'Business class', description: 'Premium business-class awards' },
  { slug: 'first', label: 'First class', description: 'First-class awards' },
  { slug: 'luxury-hotels', label: 'Luxury hotels', description: 'High-end properties' },
  { slug: 'resorts', label: 'Resort stays', description: 'Beach, island and villa resorts' },
  { slug: 'vacations', label: 'Complete vacations', description: 'Flight + hotel packages' },
  { slug: 'transfer-bonuses', label: 'Transfer bonuses', description: 'Deals improved by an active Chase transfer bonus' },
  { slug: 'weekend', label: 'Weekend trips', description: 'Short Thursday–Sunday escapes' },
  { slug: 'long-haul', label: 'Long-haul adventures', description: 'Flights of 8+ hours' },
  { slug: 'last-minute', label: 'Last-minute awards', description: 'Travel within 21 days' },
  { slug: 'sweet-spots', label: 'Hidden sweet spots', description: 'Hidden gems and overlooked redemptions' },
  { slug: 'under-50k', label: 'Under 50,000 points', description: 'Fewer than 50,000 Chase points' },
  { slug: 'under-100k', label: 'Under 100,000 points', description: 'Fewer than 100,000 Chase points' },
  { slug: 'within-budget', label: 'Within your budget', description: 'Fits your points balance and cash budget' },
] as const
export type CategorySlug = (typeof CATEGORY_DEFS)[number]['slug']

export const FEED_MODES = [
  { id: 'for-you', label: 'For You' },
  { id: 'worldwide', label: 'Worldwide' },
  { id: 'exceptional', label: 'Exceptional Value' },
  { id: 'luxury-hotels', label: 'Luxury Hotels' },
  { id: 'premium-cabins', label: 'Business & First' },
  { id: 'hidden-gems', label: 'Hidden Gems' },
  { id: 'weekend', label: 'Weekend Escapes' },
  { id: 'last-minute', label: 'Last-Minute' },
  { id: 'ending-soon', label: 'Ending Soon' },
  { id: 'new', label: 'Newly Discovered' },
] as const
export type FeedMode = (typeof FEED_MODES)[number]['id']

export const DEFAULT_COLLECTIONS = [
  'Dream Trips',
  'Business Class',
  'First Class',
  'Luxury Resorts',
  'Overwater Villas',
  'Weekend Escapes',
  'Hidden Gems',
  'Book Soon',
  'Future Possibilities',
] as const

export const HOME_AIRPORTS_DEFAULT = ['SAN', 'LAX', 'SNA', 'ONT', 'BUR'] as const

/** Default thresholds for evidence freshness (hours). */
export const FRESHNESS = {
  liveHours: 6,
  recentHours: 72,
} as const

/** Reminder offsets for confirmed deadlines, in minutes before the deadline. */
export const REMINDER_OFFSETS = [
  { id: '7d', minutes: 7 * 24 * 60, label: '7 days before' },
  { id: '3d', minutes: 3 * 24 * 60, label: '3 days before' },
  { id: '24h', minutes: 24 * 60, label: '24 hours before' },
  { id: '6h', minutes: 6 * 60, label: '6 hours before' },
  { id: '1h', minutes: 60, label: '1 hour before' },
] as const
export type ReminderOffsetId = (typeof REMINDER_OFFSETS)[number]['id']

/** Programs bookable without a transfer. */
export const CHASE_TRAVEL_PROGRAM_ID = 'chase_travel'
