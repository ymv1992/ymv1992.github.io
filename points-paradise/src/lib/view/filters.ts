import { CABINS, REGIONS, type Cabin, type EvidenceStatus, type Region } from '../domain/constants'
import { SORT_OPTIONS, type RankFilters, type SortOption } from '../engine/ranking'

export type SearchParams = Record<string, string | string[] | undefined>

function one(sp: SearchParams, k: string): string | undefined {
  const v = sp[k]
  return Array.isArray(v) ? v[0] : v
}

function num(sp: SearchParams, k: string): number | null {
  const v = one(sp, k)
  if (v == null || v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}

function date(sp: SearchParams, k: string): string | null {
  const v = one(sp, k)
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
}

export const STATUS_GROUPS: Record<string, { label: string; statuses: EvidenceStatus[] }> = {
  verified: { label: 'Verified', statuses: ['verified_live', 'recently_verified'] },
  cached: { label: 'Cached', statuses: ['cached'] },
  leads: { label: 'Unverified leads', statuses: ['unverified_lead'] },
  demo: { label: 'Demo', statuses: ['demo'] },
}

export interface ParsedFilters {
  filters: RankFilters
  sort: SortOption
  /** Raw values for re-populating the form. */
  raw: Record<string, string>
  active: number
}

/** Parses leaderboard filters from the URL. Invalid values are ignored rather than erroring. */
export function parseFilters(sp: SearchParams, base: Partial<RankFilters> = {}): ParsedFilters {
  const raw: Record<string, string> = {}
  for (const k of ['q', 'region', 'from', 'maxPoints', 'maxCash', 'minNights', 'maxNights', 'dateFrom', 'dateTo', 'cabin', 'hotelCat', 'nonstop', 'positioning', 'status', 'deadlineDays', 'minCpp', 'saved', 'sort']) {
    const v = one(sp, k)
    if (v) raw[k] = v
  }
  const region = REGIONS.includes(one(sp, 'region') as Region) ? (one(sp, 'region') as Region) : null
  const cabin = CABINS.includes(one(sp, 'cabin') as Cabin) ? (one(sp, 'cabin') as Cabin) : null
  const statusKey = one(sp, 'status')
  const group = statusKey ? STATUS_GROUPS[statusKey] : undefined
  const positioning = one(sp, 'positioning')
  const saved = one(sp, 'saved')
  const from = one(sp, 'from')?.trim().toUpperCase()
  const filters: RankFilters = {
    ...base,
    query: one(sp, 'q')?.trim().slice(0, 80) || undefined,
    region,
    departureAirport: from && /^[A-Z]{3}$/.test(from) ? from : null,
    maxPoints: num(sp, 'maxPoints'),
    maxCash: num(sp, 'maxCash'),
    minNights: num(sp, 'minNights'),
    maxNights: num(sp, 'maxNights'),
    travelFrom: date(sp, 'dateFrom'),
    travelTo: date(sp, 'dateTo'),
    cabin,
    hotelCategory: one(sp, 'hotelCat')?.trim().slice(0, 40) || null,
    nonstopOnly: one(sp, 'nonstop') === 'on' || one(sp, 'nonstop') === '1',
    positioningRequired: positioning === 'yes' || positioning === 'no' ? positioning : 'any',
    statuses: group?.statuses ?? null,
    deadlineWithinDays: num(sp, 'deadlineDays'),
    minCpp: num(sp, 'minCpp'),
    saved: saved === 'saved' || saved === 'unsaved' ? saved : 'any',
  }
  const sortRaw = one(sp, 'sort')
  const sort = SORT_OPTIONS.some((s) => s.id === sortRaw) ? (sortRaw as SortOption) : 'efficiency'
  const active = Object.keys(raw).filter((k) => k !== 'sort').length
  return { filters, sort, raw, active }
}
