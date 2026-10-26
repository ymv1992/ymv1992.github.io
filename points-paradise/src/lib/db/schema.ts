import { sql } from 'drizzle-orm'
import {
  bigserial,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import type { CashProduct, FlightDetails, HotelDetails, TransferRatio } from '../domain/types'

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })
const createdAt = () => ts('created_at').notNull().defaultNow()
const updatedAt = () => ts('updated_at').notNull().defaultNow()

// ─── Identity ────────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Login identifier (owner email). Kept separate so another auth provider can be added later. */
  authIdentifier: text('auth_identifier').notNull().unique(),
  displayName: text('display_name'),
  createdAt: createdAt(),
  lastLoginAt: ts('last_login_at'),
})

export const authAttempts = pgTable(
  'auth_attempts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    ip: text('ip').notNull(),
    success: boolean('success').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('auth_attempts_ip_time_idx').on(t.ip, t.createdAt)],
)

export interface AlertPrefsJson {
  enabledTypes: string[]
  minCpp: number | null
  maxPoints: number | null
  maxCashUsd: number | null
  destinations: string[]
  cabins: string[]
  hotelCategories: string[]
  travelFrom: string | null
  travelTo: string | null
  urgentOnly: boolean
  frequency: 'instant' | 'daily'
  quietHoursStart: string | null
  quietHoursEnd: string | null
  reminderOffsets: string[]
}

export const userSettings = pgTable('user_settings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  demoMode: boolean('demo_mode').notNull().default(true),
  onboardingCompletedAt: ts('onboarding_completed_at'),
  pointFloorCents: doublePrecision('point_floor_cents').notNull().default(1),
  minAcceptableCpp: doublePrecision('min_acceptable_cpp').notNull().default(1.5),
  monthlyApiBudgetUsd: doublePrecision('monthly_api_budget_usd').notNull().default(5),
  aiEnabled: boolean('ai_enabled').notNull().default(false),
  aiMonthlyBudgetUsd: doublePrecision('ai_monthly_budget_usd').notNull().default(2),
  emailEnabled: boolean('email_enabled').notNull().default(false),
  notificationEmail: text('notification_email'),
  browserNotifications: boolean('browser_notifications').notNull().default(false),
  timezone: text('timezone').notNull().default('America/Los_Angeles'),
  alertPrefs: jsonb('alert_prefs').$type<AlertPrefsJson>(),
  foodPerPersonPerDayUsd: doublePrecision('food_per_person_per_day_usd').notNull().default(100),
  travelers: integer('travelers').notNull().default(2),
  activeProfileId: uuid('active_profile_id'),
  /** Daily seats.aero search from the home airports to popular and dream destinations. */
  discoveryEnabled: boolean('discovery_enabled').notNull().default(true),
  discoveryCabins: text('discovery_cabins').array().notNull().default(sql`'{business,first}'::text[]`),
  /** Daily rooms.aero search for award nights at Chase hotel partners. */
  hotelDiscoveryEnabled: boolean('hotel_discovery_enabled').notNull().default(true),
  updatedAt: updatedAt(),
})

export const pointsWallets = pgTable('points_wallets', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  chaseBalance: integer('chase_balance').notNull().default(150_000),
  cardType: text('card_type').notNull().default('sapphire_preferred'),
  /** Miles/points already held in partner programs, keyed by partner id. */
  partnerBalances: jsonb('partner_balances').$type<Record<string, number>>().notNull().default({}),
  updatedAt: updatedAt(),
})

export const travelProfiles = pgTable(
  'travel_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(false),
    tripStyles: text('trip_styles').array().notNull().default(sql`'{}'::text[]`),
    tagPreferences: jsonb('tag_preferences').$type<Record<string, number>>().notNull().default({}),
    learnedWeights: jsonb('learned_weights').$type<Record<string, number>>().notNull().default({}),
    homeAirports: text('home_airports').array().notNull().default(sql`'{}'::text[]`),
    maxCashUsd: doublePrecision('max_cash_usd').notNull().default(1000),
    maxPoints: integer('max_points'),
    tripNightsMin: integer('trip_nights_min'),
    tripNightsMax: integer('trip_nights_max'),
    maxFlightHours: doublePrecision('max_flight_hours'),
    dateFlexibility: text('date_flexibility').notNull().default('few_weeks'),
    visited: text('visited').array().notNull().default(sql`'{}'::text[]`),
    dreamDestinations: text('dream_destinations').array().notNull().default(sql`'{}'::text[]`),
    dealBreakers: text('deal_breakers').array().notNull().default(sql`'{}'::text[]`),
    preferredCategories: text('preferred_categories').array().notNull().default(sql`'{}'::text[]`),
    preferNewPlaces: boolean('prefer_new_places').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('travel_profiles_user_idx').on(t.userId)],
)

// ─── Transfer partners ───────────────────────────────────────────────────────

export const transferPartners = pgTable('transfer_partners', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  programName: text('program_name').notNull(),
  type: text('type').$type<'airline' | 'hotel'>().notNull(),
  alliance: text('alliance'),
  baseRatioChase: integer('base_ratio_chase').notNull().default(1),
  baseRatioPartner: integer('base_ratio_partner').notNull().default(1),
  cardRatioOverrides: jsonb('card_ratio_overrides').$type<Record<string, TransferRatio>>().notNull().default({}),
  minTransfer: integer('min_transfer').notNull().default(1000),
  transferIncrement: integer('transfer_increment').notNull().default(1000),
  bonusRounding: text('bonus_rounding').$type<'floor' | 'round' | 'ceil'>().notNull().default('floor'),
  processingTime: text('processing_time').notNull().default('Unknown'),
  restrictions: text('restrictions'),
  bookingLimitations: text('booking_limitations'),
  transferInstructions: text('transfer_instructions'),
  programUrl: text('program_url'),
  sourceUrls: text('source_urls').array().notNull().default(sql`'{}'::text[]`),
  lastVerifiedAt: ts('last_verified_at'),
  verificationStatus: text('verification_status')
    .$type<'official_verified' | 'research_seed' | 'owner_verified' | 'stale'>()
    .notNull()
    .default('research_seed'),
  active: boolean('active').notNull().default(true),
  /** Owner's rough value estimate for the partner currency, used to judge bonuses. */
  typicalValueCents: doublePrecision('typical_value_cents'),
  notes: text('notes'),
  updatedAt: updatedAt(),
})

export const transferPromotions = pgTable(
  'transfer_promotions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    partnerId: text('partner_id')
      .notNull()
      .references(() => transferPartners.id, { onDelete: 'cascade' }),
    bonusPercent: doublePrecision('bonus_percent').notNull(),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at'),
    endsAtTimezone: text('ends_at_timezone'),
    eligibleCardTypes: text('eligible_card_types').array(),
    isTargeted: boolean('is_targeted').notNull().default(false),
    eligibility: text('eligibility'),
    sourceUrl: text('source_url'),
    sourceKind: text('source_kind').$type<'official' | 'announcement' | 'manual'>().notNull(),
    verificationStatus: text('verification_status').$type<'official_verified' | 'reported' | 'owner_verified'>().notNull(),
    lastVerifiedAt: ts('last_verified_at'),
    notes: text('notes'),
    createdAt: createdAt(),
  },
  (t) => [index('transfer_promotions_partner_idx').on(t.partnerId), index('transfer_promotions_ends_idx').on(t.endsAt)],
)

// ─── Deals ───────────────────────────────────────────────────────────────────

export const deals = pgTable(
  'deals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Natural key used to merge repeat observations of the same opportunity. */
    dedupeKey: text('dedupe_key').notNull(),
    kind: text('kind').$type<'flight' | 'hotel' | 'package' | 'experience'>().notNull(),
    title: text('title').notNull(),
    destCity: text('dest_city').notNull(),
    destCountry: text('dest_country').notNull(),
    destCountryCode: text('dest_country_code'),
    destRegion: text('dest_region').notNull(),
    destAirport: text('dest_airport'),
    destLat: doublePrecision('dest_lat'),
    destLon: doublePrecision('dest_lon'),
    originAirport: text('origin_airport'),
    providerName: text('provider_name').notNull(),
    programId: text('program_id'),
    programPoints: integer('program_points'),
    mandatoryCashUsd: doublePrecision('mandatory_cash_usd'),
    comparableCashUsd: doublePrecision('comparable_cash_usd'),
    comparableCashSource: text('comparable_cash_source').notNull().default('unknown'),
    comparableCashObservedAt: ts('comparable_cash_observed_at'),
    alternativeCashUsd: doublePrecision('alternative_cash_usd'),
    travelStart: date('travel_start', { mode: 'string' }),
    travelEnd: date('travel_end', { mode: 'string' }),
    nights: integer('nights'),
    flexibleDates: boolean('flexible_dates').notNull().default(false),
    flight: jsonb('flight').$type<FlightDetails>(),
    hotel: jsonb('hotel').$type<HotelDetails>(),
    cashProduct: jsonb('cash_product').$type<CashProduct>(),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    sourceKind: text('source_kind').notNull(),
    sourceName: text('source_name').notNull(),
    sourceUrl: text('source_url'),
    /** Provider's own identifier (e.g. an availability id) for re-checks. */
    sourceRef: text('source_ref'),
    collectedAt: ts('collected_at').notNull().defaultNow(),
    lastVerifiedAt: ts('last_verified_at'),
    verificationMethod: text('verification_method'),
    availability: text('availability').notNull().default('unknown'),
    missingInfo: text('missing_info').array().notNull().default(sql`'{}'::text[]`),
    deadlineAt: ts('deadline_at'),
    deadlineType: text('deadline_type').notNull().default('none'),
    deadlineSource: text('deadline_source'),
    deadlineTimezone: text('deadline_timezone'),
    whyNoteworthy: text('why_noteworthy'),
    imageUrl: text('image_url'),
    imageCredit: text('image_credit'),
    bookingUrl: text('booking_url'),
    assumedBonusPercent: doublePrecision('assumed_bonus_percent'),
    /** Denormalised for indexing; recomputed when deals or promotions change. */
    cachedCpp: doublePrecision('cached_cpp'),
    cachedChasePoints: integer('cached_chase_points'),
    archivedAt: ts('archived_at'),
    archiveReason: text('archive_reason'),
    firstSeenAt: ts('first_seen_at').notNull().defaultNow(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('deals_dedupe_key_idx').on(t.dedupeKey),
    index('deals_travel_start_idx').on(t.travelStart),
    index('deals_route_idx').on(t.originAirport, t.destAirport),
    index('deals_cpp_idx').on(t.cachedCpp),
    index('deals_archived_idx').on(t.archivedAt),
    index('deals_source_kind_idx').on(t.sourceKind),
    index('deals_verified_idx').on(t.lastVerifiedAt),
    index('deals_deadline_idx').on(t.deadlineAt),
  ],
)

export const dealPriceHistory = pgTable(
  'deal_price_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deals.id, { onDelete: 'cascade' }),
    observedAt: ts('observed_at').notNull().defaultNow(),
    programPoints: integer('program_points'),
    chasePoints: integer('chase_points'),
    cashUsd: doublePrecision('cash_usd'),
    mandatoryCashUsd: doublePrecision('mandatory_cash_usd'),
    availability: text('availability').notNull(),
    source: text('source').notNull(),
  },
  (t) => [index('deal_price_history_deal_time_idx').on(t.dealId, t.observedAt)],
)

// ─── Saved deals ─────────────────────────────────────────────────────────────

export const collections = pgTable(
  'collections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    sort: integer('sort').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('collections_user_name_idx').on(t.userId, t.name)],
)

export const savedDeals = pgTable(
  'saved_deals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deals.id, { onDelete: 'cascade' }),
    notes: text('notes'),
    savedAt: ts('saved_at').notNull().defaultNow(),
    originalProgramPoints: integer('original_program_points'),
    originalChasePoints: integer('original_chase_points'),
    originalCashUsd: doublePrecision('original_cash_usd'),
    originalComparableUsd: doublePrecision('original_comparable_usd'),
    originalCpp: doublePrecision('original_cpp'),
    latestProgramPoints: integer('latest_program_points'),
    latestChasePoints: integer('latest_chase_points'),
    latestCpp: doublePrecision('latest_cpp'),
    latestObservedAt: ts('latest_observed_at'),
    alertPriceDrop: boolean('alert_price_drop').notNull().default(true),
    alertAvailability: boolean('alert_availability').notNull().default(true),
    alertDeadline: boolean('alert_deadline').notNull().default(true),
    rating: integer('rating'),
    archivedAt: ts('archived_at'),
    bookedAt: ts('booked_at'),
  },
  (t) => [uniqueIndex('saved_deals_user_deal_idx').on(t.userId, t.dealId), index('saved_deals_user_idx').on(t.userId)],
)

export const savedDealCollections = pgTable(
  'saved_deal_collections',
  {
    savedDealId: uuid('saved_deal_id')
      .notNull()
      .references(() => savedDeals.id, { onDelete: 'cascade' }),
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.savedDealId, t.collectionId] })],
)

export interface WatchCriteria {
  maxProgramPoints?: number | null
  maxChasePoints?: number | null
  minCpp?: number | null
  maxCashUsd?: number | null
}

export const watchlists = pgTable(
  'watchlists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<'deal' | 'route' | 'property' | 'similar'>().notNull(),
    dealId: uuid('deal_id').references(() => deals.id, { onDelete: 'set null' }),
    label: text('label').notNull(),
    origins: text('origins').array().notNull().default(sql`'{}'::text[]`),
    destinations: text('destinations').array().notNull().default(sql`'{}'::text[]`),
    property: text('property'),
    programId: text('program_id'),
    cabin: text('cabin'),
    dateFrom: date('date_from', { mode: 'string' }),
    dateTo: date('date_to', { mode: 'string' }),
    criteria: jsonb('criteria').$type<WatchCriteria>().notNull().default({}),
    refreshHours: integer('refresh_hours').notNull().default(24),
    provider: text('provider'),
    autoCheckSupported: boolean('auto_check_supported').notNull().default(false),
    lastCheckedAt: ts('last_checked_at'),
    unchangedStreak: integer('unchanged_streak').notNull().default(0),
    lastResultHash: text('last_result_hash'),
    lastError: text('last_error'),
    active: boolean('active').notNull().default(true),
    notes: text('notes'),
    createdAt: createdAt(),
  },
  (t) => [index('watchlists_user_idx').on(t.userId)],
)

// ─── Signals ─────────────────────────────────────────────────────────────────

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    dealId: uuid('deal_id').references(() => deals.id, { onDelete: 'set null' }),
    promotionId: uuid('promotion_id').references(() => transferPromotions.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    body: text('body').notNull(),
    link: text('link').notNull(),
    /** Unique per user; guarantees an event is notified at most once. */
    dedupeKey: text('dedupe_key').notNull(),
    status: text('status').$type<'pending' | 'sent' | 'deferred' | 'digest' | 'skipped' | 'suppressed'>().notNull(),
    emailStatus: text('email_status'),
    createdAt: createdAt(),
    sentAt: ts('sent_at'),
    readAt: ts('read_at'),
  },
  (t) => [
    uniqueIndex('notifications_user_dedupe_idx').on(t.userId, t.dedupeKey),
    index('notifications_user_created_idx').on(t.userId, t.createdAt),
  ],
)

export const feedback = pgTable(
  'feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    dealId: uuid('deal_id').references(() => deals.id, { onDelete: 'cascade' }),
    feedbackType: text('feedback_type').notNull(),
    rating: integer('rating'),
    notes: text('notes'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    createdAt: createdAt(),
    undoneAt: ts('undone_at'),
  },
  (t) => [index('feedback_user_deal_idx').on(t.userId, t.dealId)],
)

export const searchHistory = pgTable('search_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  context: text('context').notNull(),
  query: jsonb('query').$type<Record<string, unknown>>().notNull(),
  createdAt: createdAt(),
})

// ─── Operations ──────────────────────────────────────────────────────────────

export const searchJobs = pgTable(
  'search_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull(),
    jobType: text('job_type').notNull(),
    params: jsonb('params').$type<Record<string, unknown>>().notNull().default({}),
    status: text('status')
      .$type<'queued' | 'running' | 'succeeded' | 'failed' | 'skipped_budget' | 'skipped_unconfigured' | 'skipped_quota'>()
      .notNull(),
    priority: doublePrecision('priority'),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
    durationMs: integer('duration_ms'),
    requestCount: integer('request_count').notNull().default(0),
    estimatedCostUsd: doublePrecision('estimated_cost_usd').notNull().default(0),
    resultsCount: integer('results_count').notNull().default(0),
    error: text('error'),
    createdAt: createdAt(),
  },
  (t) => [index('search_jobs_provider_time_idx').on(t.provider, t.createdAt), index('search_jobs_status_idx').on(t.status)],
)

export const dataSources = pgTable('data_sources', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  sourceType: text('source_type').notNull(),
  authRequirements: text('auth_requirements').notNull(),
  freeTier: text('free_tier').notNull(),
  rateLimits: text('rate_limits').notNull(),
  usageRestrictions: text('usage_restrictions').notNull(),
  freshness: text('freshness').notNull(),
  reliability: text('reliability').notNull(),
  cacheTtlHours: integer('cache_ttl_hours'),
  refreshIntervalHours: integer('refresh_interval_hours'),
  costPerRequestUsd: doublePrecision('cost_per_request_usd').notNull().default(0),
  monthlyQuota: integer('monthly_quota'),
  dailyQuota: integer('daily_quota'),
  enabled: boolean('enabled').notNull().default(true),
  healthStatus: text('health_status').notNull().default('unknown'),
  lastSuccessAt: ts('last_success_at'),
  lastErrorAt: ts('last_error_at'),
  lastError: text('last_error'),
  docsUrl: text('docs_url'),
  notes: text('notes'),
  updatedAt: updatedAt(),
})

export const announcements = pgTable(
  'announcements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    feedUrl: text('feed_url').notNull(),
    title: text('title').notNull(),
    url: text('url').notNull(),
    publishedAt: ts('published_at'),
    matchedKeywords: text('matched_keywords').array().notNull().default(sql`'{}'::text[]`),
    status: text('status').$type<'new' | 'converted' | 'dismissed'>().notNull().default('new'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('announcements_url_idx').on(t.url)],
)

export const mediaCache = pgTable('media_cache', {
  query: text('query').primaryKey(),
  url: text('url').notNull(),
  thumbUrl: text('thumb_url'),
  creditName: text('credit_name'),
  creditUrl: text('credit_url'),
  provider: text('provider').notNull(),
  fetchedAt: ts('fetched_at').notNull().defaultNow(),
})

export const appState = pgTable('app_state', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedAt: updatedAt(),
})
