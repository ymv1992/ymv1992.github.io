/** Display formatting shared by server and client components. */

export function usd(n: number | null | undefined, opts: { cents?: boolean } = {}): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: opts.cents ? 2 : 0,
    minimumFractionDigits: opts.cents ? 2 : 0,
  }).format(n)
}

export function points(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('en-US').format(Math.round(n))
}

export function compactPoints(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`
  return String(n)
}

export function cpp(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${n.toFixed(2)}¢`
}

export function dateLabel(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }): string {
  if (!iso) return 'Dates not set'
  const d = new Date(`${iso}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }).format(d)
}

export function dateRange(start: string | null, end: string | null): string {
  if (!start) return 'Dates not set'
  if (!end || end === start) return dateLabel(start)
  const s = new Date(`${start}T12:00:00Z`)
  const e = new Date(`${end}T12:00:00Z`)
  const sameYear = s.getUTCFullYear() === e.getUTCFullYear()
  return `${dateLabel(start, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })} – ${dateLabel(end)}`
}

export function dateTime(d: Date | string | null | undefined, timeZone: string): string {
  if (!d) return '—'
  const date = typeof d === 'string' ? new Date(d) : d
  try {
    // dateStyle/timeStyle cannot be combined with timeZoneName, so spell the fields out.
    return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone, timeZoneName: 'short' }).format(date)
  } catch {
    return date.toISOString()
  }
}

export function minutesLabel(m: number | null | undefined): string {
  if (m == null) return '—'
  const h = Math.floor(m / 60)
  const mm = m % 60
  return h ? `${h}h${mm ? ` ${mm}m` : ''}` : `${mm}m`
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralWord}`
}

export function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
