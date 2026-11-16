/** Shared domain vocabulary. No personal data lives in this repository; everything the owner enters is stored in the database. */

export const BUCKETS = ['us_index', 'international', 'ai_big_tech', 'other_stocks', 'bonds_cash', 'crypto', 'speculative'] as const
export type Bucket = (typeof BUCKETS)[number]

export const BUCKET_LABELS: Record<Bucket, string> = {
  us_index: 'US index funds',
  international: 'International funds',
  ai_big_tech: 'AI & big tech',
  other_stocks: 'Other stocks',
  bonds_cash: 'Bonds & cash',
  crypto: 'Crypto',
  speculative: 'Speculative',
}

/** Buckets that count as broad index funds for the "minimum in index funds" rule. */
export const INDEX_BUCKETS: readonly Bucket[] = ['us_index', 'international']
/** Buckets treated as a single theme for the "no theme above X%" rule. */
export const THEME_BUCKETS: readonly Bucket[] = ['ai_big_tech', 'other_stocks', 'crypto', 'speculative']

export const ASSET_CLASSES = ['stock', 'etf', 'crypto'] as const
export type AssetClass = (typeof ASSET_CLASSES)[number]

export const HOLDING_STATUSES = ['confirmed', 'unverified'] as const
export type HoldingStatus = (typeof HOLDING_STATUSES)[number]
export const HOLDING_STATUS_LABELS: Record<HoldingStatus, string> = {
  confirmed: 'Confirmed',
  unverified: 'Unverified — reconciliation required',
}

export const ASSET_CATEGORIES = ['retirement', 'cash', 'bonds', 'real_estate', 'business', 'private', 'other'] as const
export type AssetCategory = (typeof ASSET_CATEGORIES)[number]
export const ASSET_CATEGORY_LABELS: Record<AssetCategory, string> = {
  retirement: 'Retirement account (TSP, 401k, IRA)',
  cash: 'Cash & savings',
  bonds: 'Bonds & Treasuries',
  real_estate: 'Real estate',
  business: 'Business ownership',
  private: 'Private investment',
  other: 'Other asset',
}

export const ASSET_STATUSES = ['verified', 'unverified', 'needs_input'] as const
export type AssetStatus = (typeof ASSET_STATUSES)[number]
export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  verified: 'Verified',
  unverified: 'Unverified estimate',
  needs_input: 'Needs your input',
}

export const RISK_PROFILES = ['conservative', 'balanced', 'growth', 'aggressive'] as const
export type RiskProfile = (typeof RISK_PROFILES)[number]

export const TRADE_TYPES = ['buy', 'sell', 'dividend', 'fee'] as const
export type TradeType = (typeof TRADE_TYPES)[number]

export const MILESTONES = [250_000, 500_000, 1_000_000, 2_000_000, 5_000_000] as const

export interface RulesJson {
  maxSingleStockPct: number
  maxThemePct: number
  minIndexPct: number
  maxSpeculativePct: number
  maxCryptoPct: number
}

export interface ProjectionJson {
  /** Assumed average yearly return before fees, in percent. An assumption, not a forecast. */
  meanReturnPct: number
  /** Assumed yearly volatility (standard deviation), in percent. */
  volatilityPct: number
  inflationPct: number
  feePct: number
}

export interface ProfileJson {
  riskProfile: RiskProfile | null
  monthlyContribution: number | null
  monthlyIncome: number | null
  /** Self-reported total, shown for comparison only. Never added to tracked holdings. */
  reportedPortfolio: number | null
  reportedPortfolioAsOf: string | null
  birthYear: number | null
  targets: Record<Bucket, number>
  rules: RulesJson
  goalTarget: number
  goalDate: string | null
  projection: ProjectionJson
}

export const DEFAULT_PROFILE: ProfileJson = {
  riskProfile: null,
  monthlyContribution: null,
  monthlyIncome: null,
  reportedPortfolio: null,
  reportedPortfolioAsOf: null,
  birthYear: null,
  targets: { us_index: 35, international: 15, ai_big_tech: 30, other_stocks: 10, bonds_cash: 5, crypto: 5, speculative: 0 },
  rules: { maxSingleStockPct: 15, maxThemePct: 40, minIndexPct: 50, maxSpeculativePct: 5, maxCryptoPct: 5 },
  goalTarget: 1_000_000,
  goalDate: null,
  projection: { meanReturnPct: 7, volatilityPct: 16, inflationPct: 2.5, feePct: 0.1 },
}
