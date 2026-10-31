import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { AppDb } from '../db/client'
import { dataSources, searchHistory } from '../db/schema'
import { airlineCodes, AWARD_AIRLINE_CODES, AWARD_PROGRAM_IDS } from '../domain/airlines'
import { CABINS, type Cabin } from '../domain/constants'
import { withinQuota } from '../engine/budget'
import { DISCOVERY_DESTINATIONS, dreamAirports, pickCheapest } from '../jobs/discovery'
import { cachedSearch, itemToDealColumns, searchDiagnostics, type CachedSearchResult } from '../providers/seats-aero'
import { loadAccount } from './account'
import { upsertDeal } from './deals'
import { evaluateMany } from './evaluation'
import { dayStart, logJob, requestsSince } from './usage'

const iata = z.string().regex(/^[A-Z]{3}$/, 'Use a 3-letter airport code')
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const awardSearchSchema = z
  .object({
    origin: iata,
    /** null searches every discovery destination ("Anywhere"). */
    destination: iata.nullable(),
    includeHomeAirports: z.boolean(),
    cabin: z.enum(CABINS),
    startDate: isoDate,
    endDate: isoDate,
    /** Only awards flown (at least partly) by this airline; null = any. */
    airline: z.enum(AWARD_AIRLINE_CODES).nullable().default(null),
    /** Only awards bookable with this Chase partner program; null = any. */
    program: z.enum(AWARD_PROGRAM_IDS).nullable().default(null),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: 'The end date must be on or after the start date',
    path: ['endDate'],
  })

/** Airline and program filters are optional for callers (they default to "any"). */
export type AwardSearchInput = z.input<typeof awardSearchSchema>

export interface AwardSearchResultRow {
  dealId: string
  origin: string
  airport: string
  city: string
  country: string
  date: string
  points: number
  taxesUsd: number | null
  airline: string
  programId: string
  direct: boolean
  /** Chase points after the card's transfer ratio. */
  chasePoints: number | null
  /** Comparable cash price when one is known (e.g. from an earlier lookup). */
  cashUsd: number | null
  /** Practical cents per Chase point when the value can be calculated. */
  cpp: number | null
  /** Whether a cash lookup was already tried recently without a match. */
  cashLookupTried: boolean
}

export type AwardSearchOutcome =
  | {
      ok: true
      anywhere: boolean
      results: AwardSearchResultRow[]
      total: number
      created: number
      requests: number
      truncated: boolean
      failed: number
    }
  | { ok: false; error: string }

const RESULT_LIMIT = 60
const CONCURRENCY = 4

async function inBatches<T, R>(items: readonly T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))))
  return out
}

/**
 * Owner-requested award search through seats.aero's cached search. With no
 * destination it checks every discovery destination group from the origin
 * (one request per group) and keeps the cheapest date per city and month.
 */
export async function runAwardSearch(db: AppDb, userId: string, apiKey: string, input: AwardSearchInput, opts: { now?: Date; fetch?: typeof fetch } = {}): Promise<AwardSearchOutcome> {
  const now = opts.now ?? new Date()
  const doFetch = opts.fetch ?? fetch
  const [src] = await db.select().from(dataSources).where(eq(dataSources.id, 'seats_aero'))
  if (src && !src.enabled) return { ok: false, error: 'seats.aero is disabled in data sources.' }
  const account = await loadAccount(db, userId)
  const origins = input.includeHomeAirports ? [...new Set([input.origin, ...account.profile.homeAirports])].slice(0, 8) : [input.origin]
  const anywhere = input.destination == null
  const dreams = dreamAirports(account.profile.dreamDestinations)
  const groups = anywhere ? [...(dreams.length ? [dreams] : []), ...DISCOVERY_DESTINATIONS.map((g) => g.airports)] : [[input.destination!]]

  if (!withinQuota(await requestsSince(db, 'seats_aero', dayStart(now)), groups.length, src?.dailyQuota ?? 1000)) {
    await logJob(db, {
      provider: 'seats_aero',
      jobType: 'user_search',
      params: { ...input },
      status: 'skipped_quota',
      startedAt: now,
      error: 'Daily quota reached',
    })
    return {
      ok: false,
      error: 'Daily seats.aero request limit reached. Try again tomorrow.',
    }
  }

  const responses = await inBatches(groups, CONCURRENCY, async (destinations) => {
    const startedAt = new Date()
    const params = {
      origins,
      destinations,
      cabin: input.cabin,
      startDate: input.startDate,
      endDate: input.endDate,
    }
    try {
      const res = await cachedSearch(apiKey, params, doFetch)
      await logJob(db, {
        provider: 'seats_aero',
        jobType: 'user_search',
        params: { ...params, ...searchDiagnostics(res) },
        status: 'succeeded',
        startedAt,
        requestCount: res.requests,
        estimatedCostUsd: src?.costPerRequestUsd ?? 0,
        resultsCount: res.items.length,
      })
      return { destinations, res }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Search failed'
      await logJob(db, {
        provider: 'seats_aero',
        jobType: 'user_search',
        params,
        status: 'failed',
        startedAt,
        requestCount: 1,
        error: message,
      })
      return { destinations, error: message }
    }
  })
  const failures = responses.filter((r): r is { destinations: string[]; error: string } => 'error' in r)
  if (failures.length === responses.length) return { ok: false, error: failures[0]?.error ?? 'Search failed' }

  type Mapped = NonNullable<ReturnType<typeof itemToDealColumns>>
  const mapped: Mapped[] = []
  let truncated = false
  for (const r of responses) {
    if (!('res' in r)) continue
    const res = r.res as CachedSearchResult
    truncated ||= res.truncated
    for (const item of res.items) {
      const m = itemToDealColumns(item, input.cabin as Cabin)
      if (!m || !m.originAirport || !origins.includes(m.originAirport) || !r.destinations.includes(m.destAirport ?? '')) continue
      if (input.program && m.programId !== input.program) continue
      if (input.airline && !airlineCodes(m.flight?.operatingAirline).includes(input.airline)) continue
      mapped.push(m)
    }
  }
  const kept = anywhere ? pickCheapest(mapped) : mapped
  const results: AwardSearchResultRow[] = []
  let created = 0
  for (const m of kept) {
    const { verifiedAt, ...cols } = m
    const up = await upsertDeal(db, cols, {
      now,
      verified: true,
      verifiedAt: verifiedAt ?? now,
      historySource: 'seats_aero',
    })
    if (up.isNew) created++
    results.push({
      dealId: up.id,
      origin: cols.originAirport ?? '',
      airport: cols.destAirport ?? '',
      city: cols.destCity,
      country: cols.destCountry,
      date: cols.travelStart ?? '',
      points: cols.programPoints ?? 0,
      taxesUsd: cols.mandatoryCashUsd,
      airline: cols.providerName,
      programId: cols.programId ?? '',
      direct: cols.flight?.stops === 0,
      chasePoints: null,
      cashUsd: null,
      cpp: null,
      cashLookupTried: false,
    })
  }
  results.sort((a, b) => a.points - b.points || a.date.localeCompare(b.date) || a.city.localeCompare(b.city))
  const shown = results.slice(0, RESULT_LIMIT)
  // Value what is shown: Chase points after the card's ratio, and ¢/pt where a cash price is already known.
  const values = await evaluateMany(db, userId, shown.map((r) => r.dealId), now)
  for (const r of shown) {
    const e = values.get(r.dealId)
    if (!e) continue
    r.chasePoints = e.valuation.chasePoints
    r.cashUsd = e.deal.comparableCashUsd
    r.cpp = e.valuation.calculable ? (e.valuation.practicalCpp ?? e.valuation.headlineCpp) : null
    r.cashLookupTried = e.deal.comparableCashUsd == null && e.deal.comparableCashObservedAt != null
  }
  await db.insert(searchHistory).values({
    userId,
    context: anywhere ? 'award_search_anywhere' : 'award_search',
    query: { ...input, origins },
  })
  return {
    ok: true,
    anywhere,
    results: shown,
    total: results.length,
    created,
    requests: responses.length,
    truncated,
    failed: failures.length,
  }
}
