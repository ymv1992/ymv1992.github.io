/** Currencies for trip costs, and showing amounts in their own currency and in dollars. Safe for browser components. */
import type { TripRate } from '../db/schema'

export type { TripRate }

/** Currencies travellers are likely to need, with fixed English names (the same on the server and in every browser). */
export const CURRENCIES: readonly (readonly [code: string, name: string])[] = [
  ['USD', 'US dollar'],
  ['EUR', 'Euro'],
  ['GBP', 'British pound'],
  ['JPY', 'Japanese yen'],
  ['MXN', 'Mexican peso'],
  ['CAD', 'Canadian dollar'],
  ['AUD', 'Australian dollar'],
  ['NZD', 'New Zealand dollar'],
  ['CHF', 'Swiss franc'],
  ['CNY', 'Chinese yuan'],
  ['HKD', 'Hong Kong dollar'],
  ['TWD', 'New Taiwan dollar'],
  ['KRW', 'South Korean won'],
  ['SGD', 'Singapore dollar'],
  ['THB', 'Thai baht'],
  ['VND', 'Vietnamese dong'],
  ['IDR', 'Indonesian rupiah'],
  ['MYR', 'Malaysian ringgit'],
  ['PHP', 'Philippine peso'],
  ['INR', 'Indian rupee'],
  ['LKR', 'Sri Lankan rupee'],
  ['MVR', 'Maldivian rufiyaa'],
  ['NPR', 'Nepalese rupee'],
  ['KHR', 'Cambodian riel'],
  ['LAK', 'Lao kip'],
  ['MOP', 'Macanese pataca'],
  ['AED', 'UAE dirham'],
  ['QAR', 'Qatari riyal'],
  ['SAR', 'Saudi riyal'],
  ['OMR', 'Omani rial'],
  ['BHD', 'Bahraini dinar'],
  ['JOD', 'Jordanian dinar'],
  ['ILS', 'Israeli shekel'],
  ['TRY', 'Turkish lira'],
  ['EGP', 'Egyptian pound'],
  ['MAD', 'Moroccan dirham'],
  ['TND', 'Tunisian dinar'],
  ['ZAR', 'South African rand'],
  ['KES', 'Kenyan shilling'],
  ['TZS', 'Tanzanian shilling'],
  ['MUR', 'Mauritian rupee'],
  ['SCR', 'Seychelles rupee'],
  ['NAD', 'Namibian dollar'],
  ['BWP', 'Botswana pula'],
  ['ISK', 'Icelandic króna'],
  ['NOK', 'Norwegian krone'],
  ['SEK', 'Swedish krona'],
  ['DKK', 'Danish krone'],
  ['PLN', 'Polish złoty'],
  ['CZK', 'Czech koruna'],
  ['HUF', 'Hungarian forint'],
  ['RON', 'Romanian leu'],
  ['BGN', 'Bulgarian lev'],
  ['RSD', 'Serbian dinar'],
  ['GEL', 'Georgian lari'],
  ['BRL', 'Brazilian real'],
  ['ARS', 'Argentine peso'],
  ['CLP', 'Chilean peso'],
  ['COP', 'Colombian peso'],
  ['PEN', 'Peruvian sol'],
  ['UYU', 'Uruguayan peso'],
  ['CRC', 'Costa Rican colón'],
  ['GTQ', 'Guatemalan quetzal'],
  ['BZD', 'Belize dollar'],
  ['PAB', 'Panamanian balboa'],
  ['DOP', 'Dominican peso'],
  ['JMD', 'Jamaican dollar'],
  ['BSD', 'Bahamian dollar'],
  ['BBD', 'Barbados dollar'],
  ['TTD', 'Trinidad and Tobago dollar'],
  ['XCD', 'East Caribbean dollar'],
  ['AWG', 'Aruban florin'],
  ['KYD', 'Cayman Islands dollar'],
  ['FJD', 'Fijian dollar'],
  ['XPF', 'CFP franc (Tahiti, New Caledonia)'],
  ['WST', 'Samoan tala'],
  ['TOP', 'Tongan paʻanga'],
]

const NAMES = new Map(CURRENCIES.map(([c, n]) => [c, n]))
export const CURRENCY_CODES = CURRENCIES.map(([c]) => c) as [string, ...string[]]

export function currencyName(code: string): string {
  return NAMES.get(code) ?? code
}

export function isKnownCurrency(code: string | null | undefined): code is string {
  return !!code && NAMES.has(code)
}

/**
 * An amount in its own currency: "¥12,000", "€40", "$12.50". With `code`,
 * uses the ISO code instead of a symbol ("JPY 12,000"), for the PDF.
 */
export function formatMoney(amount: number, currency: string, opts: { code?: boolean } = {}): string {
  const format = (display: 'code' | 'symbol') =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: display, ...(Number.isInteger(amount) ? { minimumFractionDigits: 0 } : {}) })
  try {
    if (opts.code) return format('code').format(amount)
    const symbol = format('symbol')
    // Some currencies have no symbol, only an unfamiliar abbreviation (XPF shows as "CFPF"); the ISO code is clearer there.
    const sign = symbol.formatToParts(amount).find((p) => p.type === 'currency')?.value ?? ''
    return /^[A-Za-z]{2,}$/.test(sign) && sign !== currency ? format('code').format(amount) : symbol.format(amount)
  } catch {
    return `${currency} ${amount.toLocaleString('en-US')}`
  }
}

/** Rounded dollar figure for "about $81" labels. */
export function formatUsd(amount: number): string {
  return `$${amount.toLocaleString('en-US', { maximumFractionDigits: Math.abs(amount) >= 20 ? 0 : 2 })}`
}

/** Dollar value of an amount at the trip's locked rate; null when there is no rate for that currency yet. */
export function toUsd(amount: number, currency: string, rates: Record<string, TripRate>): number | null {
  if (currency === 'USD') return amount
  const r = rates[currency]
  return r && r.perUsd > 0 ? amount / r.perUsd : null
}

/** "¥12,000 · about $81", "$40", or "¥12,000 · no rate yet". */
export function costLabel(amount: number, currency: string, rates: Record<string, TripRate>, opts: { code?: boolean } = {}): string {
  const local = formatMoney(amount, currency, opts)
  if (currency === 'USD') return local
  const usd = toUsd(amount, currency, rates)
  return usd == null ? `${local} · no rate yet` : `${local} · about ${formatUsd(usd)}`
}

/** Where a rate came from, in plain words. */
export function rateSourceLabel(r: TripRate): string {
  return r.source === 'manual' ? 'Your rate' : r.source === 'ecb' ? 'European Central Bank rate' : 'Market rate'
}
