import type { AssetClass, Bucket } from './types'

/**
 * Generic starting classifications for widely held securities, used only to
 * suggest a bucket when something is imported. The owner can change the bucket
 * of any holding. This is public reference data, not a record of ownership.
 */
const US_INDEX = ['VTI', 'VOO', 'SPY', 'IVV', 'ITOT', 'SCHB', 'SCHX', 'SPLG', 'FXAIX', 'VTSAX', 'SWTSX', 'QQQ', 'QQQM', 'DIA', 'IWM', 'VUG', 'VTV', 'SCHD', 'VIG', 'VYM']
const INTERNATIONAL = ['VEU', 'VXUS', 'IXUS', 'VEA', 'VWO', 'IEFA', 'IEMG', 'EFA', 'EEM', 'SCHF', 'ACWX', 'VT']
const BONDS_CASH = ['BND', 'AGG', 'SGOV', 'BIL', 'SHY', 'IEF', 'TLT', 'VGSH', 'VGIT', 'VTIP', 'TIP', 'SCHZ', 'BNDX', 'USFR']
const AI_BIG_TECH = ['AAPL', 'MSFT', 'NVDA', 'GOOG', 'GOOGL', 'AMZN', 'META', 'TSLA', 'AVGO', 'AMD', 'PLTR', 'ORCL', 'CRM', 'NFLX', 'ADBE', 'TSM', 'ASML', 'INTC', 'MU', 'SMCI', 'SNOW', 'NOW', 'ARM']

export const CRYPTO_IDS: Record<string, { id: string; name: string }> = {
  BTC: { id: 'bitcoin', name: 'Bitcoin' },
  ETH: { id: 'ethereum', name: 'Ethereum' },
  XRP: { id: 'ripple', name: 'XRP' },
  SOL: { id: 'solana', name: 'Solana' },
  ADA: { id: 'cardano', name: 'Cardano' },
  DOGE: { id: 'dogecoin', name: 'Dogecoin' },
  LTC: { id: 'litecoin', name: 'Litecoin' },
  LINK: { id: 'chainlink', name: 'Chainlink' },
  AVAX: { id: 'avalanche-2', name: 'Avalanche' },
  DOT: { id: 'polkadot', name: 'Polkadot' },
}

const CRYPTO_ALIASES: Record<string, string> = { BITCOIN: 'BTC', ETHEREUM: 'ETH', RIPPLE: 'XRP', SOLANA: 'SOL' }

export function normalizeSymbol(raw: string): string {
  const s = raw.trim().toUpperCase().replace(/^\$/, '')
  return CRYPTO_ALIASES[s] ?? s
}

export function classifySymbol(symbol: string): { assetClass: AssetClass; bucket: Bucket; name: string | null } {
  const s = normalizeSymbol(symbol)
  if (CRYPTO_IDS[s]) return { assetClass: 'crypto', bucket: 'crypto', name: CRYPTO_IDS[s].name }
  if (US_INDEX.includes(s)) return { assetClass: 'etf', bucket: 'us_index', name: null }
  if (INTERNATIONAL.includes(s)) return { assetClass: 'etf', bucket: 'international', name: null }
  if (BONDS_CASH.includes(s)) return { assetClass: 'etf', bucket: 'bonds_cash', name: null }
  if (AI_BIG_TECH.includes(s)) return { assetClass: 'stock', bucket: 'ai_big_tech', name: null }
  return { assetClass: 'stock', bucket: 'other_stocks', name: null }
}
