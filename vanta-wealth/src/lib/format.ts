const USD0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const USD2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const DASH = '—'

export function usd(n: number | null | undefined, cents = false): string {
  if (n == null || !Number.isFinite(n)) return DASH
  return (cents ? USD2 : USD0).format(n)
}

/** Prices keep extra decimals below $1 so small-priced assets stay readable. */
export function price(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return DASH
  if (Math.abs(n) < 1) return `$${n.toFixed(4)}`
  return USD2.format(n)
}

export function signedUsd(n: number | null | undefined, cents = false): string {
  if (n == null || !Number.isFinite(n)) return DASH
  const s = (cents ? USD2 : USD0).format(Math.abs(n))
  return n > 0 ? `+${s}` : n < 0 ? `−${s}` : s
}

export function pct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return DASH
  return `${n.toFixed(digits)}%`
}

export function signedPct(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return DASH
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(digits)}%`
}

export function compactUsd(n: number): string {
  const a = Math.abs(n)
  if (a >= 1e6) return `$${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`
  if (a >= 1e3) return `$${Math.round(n / 1e3)}K`
  return `$${Math.round(n)}`
}

export function qty(n: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 5 }).format(n)
}

export function shortDate(d: Date | string | null | undefined): string {
  if (!d) return DASH
  const date = typeof d === 'string' ? new Date(d.length === 10 ? `${d}T12:00:00Z` : d) : d
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

export function dateTime(d: Date | null | undefined): string {
  if (!d) return DASH
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short' })
}

export type Freshness = 'recent' | 'last' | 'stale' | 'none'

/** How old a quote is, judged by the provider's own timestamp. */
export function freshness(quoteTime: Date | null | undefined, fetchedAt: Date | null | undefined, now = new Date()): { level: Freshness; label: string } {
  const t = quoteTime ?? fetchedAt
  if (!t) return { level: 'none', label: 'No price' }
  const mins = (now.getTime() - t.getTime()) / 60_000
  if (mins <= 20) return { level: 'recent', label: 'Recent' }
  if (mins <= 4 * 24 * 60) return { level: 'last', label: 'Last available' }
  return { level: 'stale', label: 'Stale' }
}
