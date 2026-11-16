import { boolean, date, doublePrecision, index, jsonb, pgSchema, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import type { AssetCategory, AssetClass, AssetStatus, Bucket, HoldingStatus, ProfileJson, TradeType } from '../domain/types'

/** Own Postgres schema, so this app can share a database with other apps without table-name clashes. */
export const vanta = pgSchema('vanta')
const pgTable = vanta.table

const id = () => uuid('id').primaryKey().defaultRandom()
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
const userRef = () =>
  uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })

export const users = pgTable('users', {
  id: id(),
  authIdentifier: text('auth_identifier').notNull().unique(),
  createdAt: createdAt(),
}).enableRLS()

export const authAttempts = pgTable('auth_attempts', {
  id: id(),
  ip: text('ip').notNull(),
  success: boolean('success').notNull(),
  createdAt: createdAt(),
}).enableRLS()

export const profiles = pgTable('profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  data: jsonb('data').$type<ProfileJson>().notNull(),
  updatedAt: updatedAt(),
}).enableRLS()

export const holdings = pgTable(
  'holdings',
  {
    id: id(),
    userId: userRef(),
    account: text('account').notNull().default(''),
    symbol: text('symbol').notNull(),
    name: text('name').notNull().default(''),
    assetClass: text('asset_class').$type<AssetClass>().notNull(),
    bucket: text('bucket').$type<Bucket>().notNull(),
    quantity: doublePrecision('quantity').notNull(),
    /** Average purchase price per unit; null when unknown. */
    avgCost: doublePrecision('avg_cost'),
    status: text('status').$type<HoldingStatus>().notNull().default('unverified'),
    asOf: date('as_of'),
    purchaseDate: date('purchase_date'),
    thesis: text('thesis').notNull().default(''),
    sellCondition: text('sell_condition').notNull().default(''),
    notes: text('notes').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('holdings_user_account_symbol').on(t.userId, t.account, t.symbol)],
).enableRLS()

/** Assets entered by hand: retirement accounts, cash, real estate, business interests. */
export const manualAssets = pgTable('manual_assets', {
  id: id(),
  userId: userRef(),
  name: text('name').notNull(),
  category: text('category').$type<AssetCategory>().notNull(),
  /** Current value; null until the owner enters it. */
  value: doublePrecision('value'),
  /** Debt against this asset (e.g. a mortgage). */
  liability: doublePrecision('liability').notNull().default(0),
  liquid: boolean('liquid').notNull().default(false),
  /** Counts toward the investable portfolio and its allocation (e.g. a retirement account). */
  inPortfolio: boolean('in_portfolio').notNull().default(false),
  bucket: text('bucket').$type<Bucket>(),
  status: text('status').$type<AssetStatus>().notNull().default('unverified'),
  asOf: date('as_of'),
  notes: text('notes').notNull().default(''),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}).enableRLS()

export const watchlist = pgTable(
  'watchlist',
  {
    id: id(),
    userId: userRef(),
    symbol: text('symbol').notNull(),
    name: text('name').notNull().default(''),
    thesis: text('thesis').notNull().default(''),
    targetPrice: doublePrecision('target_price'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('watchlist_user_symbol').on(t.userId, t.symbol)],
).enableRLS()

/** Trade log and decision journal. */
export const trades = pgTable(
  'trades',
  {
    id: id(),
    userId: userRef(),
    tradeDate: date('trade_date').notNull(),
    symbol: text('symbol').notNull(),
    account: text('account').notNull().default(''),
    type: text('type').$type<TradeType>().notNull(),
    quantity: doublePrecision('quantity').notNull().default(0),
    price: doublePrecision('price').notNull().default(0),
    fees: doublePrecision('fees').notNull().default(0),
    /** Realized gain for sells, computed against average cost at the time. Null when cost was unknown. */
    realizedGain: doublePrecision('realized_gain'),
    appliedToHolding: boolean('applied_to_holding').notNull().default(false),
    thesis: text('thesis').notNull().default(''),
    catalyst: text('catalyst').notNull().default(''),
    risk: text('risk').notNull().default(''),
    holdingPeriod: text('holding_period').notNull().default(''),
    outcome: text('outcome').notNull().default(''),
    lessons: text('lessons').notNull().default(''),
    createdAt: createdAt(),
  },
  (t) => [index('trades_user_date').on(t.userId, t.tradeDate)],
).enableRLS()

export const notes = pgTable('notes', {
  id: id(),
  userId: userRef(),
  noteDate: date('note_date').notNull(),
  symbol: text('symbol').notNull().default(''),
  kind: text('kind').$type<'note' | 'review'>().notNull().default('note'),
  body: text('body').notNull(),
  createdAt: createdAt(),
}).enableRLS()

/** Latest price per symbol from a market-data provider. Shared cache, not personal data. */
export const quotes = pgTable('quotes', {
  symbol: text('symbol').primaryKey(),
  price: doublePrecision('price').notNull(),
  prevClose: doublePrecision('prev_close'),
  /** Time the provider says the price is from. */
  quoteTime: timestamp('quote_time', { withTimezone: true }),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
  source: text('source').notNull(),
}).enableRLS()

/** One row per day the portfolio was valued, so growth can be charted from real recorded values. */
export const snapshots = pgTable(
  'snapshots',
  {
    id: id(),
    userId: userRef(),
    day: date('day').notNull(),
    portfolioValue: doublePrecision('portfolio_value').notNull(),
    costBasis: doublePrecision('cost_basis'),
    netWorth: doublePrecision('net_worth').notNull(),
    /** True only when every holding had a market price. */
    complete: boolean('complete').notNull(),
  },
  (t) => [uniqueIndex('snapshots_user_day').on(t.userId, t.day)],
).enableRLS()

export const newsItems = pgTable(
  'news_items',
  {
    id: id(),
    symbol: text('symbol').notNull(),
    headline: text('headline').notNull(),
    summary: text('summary').notNull().default(''),
    source: text('source').notNull(),
    url: text('url').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex('news_symbol_url').on(t.symbol, t.url), index('news_published').on(t.publishedAt)],
).enableRLS()

export const earningsEvents = pgTable(
  'earnings_events',
  {
    id: id(),
    symbol: text('symbol').notNull(),
    day: date('day').notNull(),
    hour: text('hour').notNull().default(''),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex('earnings_symbol_day').on(t.symbol, t.day)],
).enableRLS()

/** Records when each provider feed was last refreshed. */
export const feedState = pgTable('feed_state', {
  key: text('key').primaryKey(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
  error: text('error'),
}).enableRLS()

export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    userId: userRef(),
    action: text('action').notNull(),
    detail: text('detail').notNull().default(''),
    createdAt: createdAt(),
  },
  (t) => [index('audit_user_created').on(t.userId, t.createdAt)],
).enableRLS()
