import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { AppDb } from '../db/client'
import { partnerFromRow, promotionFromRow } from '../db/mappers'
import { dataSources, searchHistory, transferPartners, transferPromotions } from '../db/schema'
import { airlineCodes, AWARD_AIRLINE_CODES, AWARD_PROGRAM_IDS } from '../domain/airlines'
import { CABINS, type Cabin, type CardType } from '../domain/constants'
import type { TransferPromotion } from '../domain/types'
import { withinQuota } from '../engine/budget'
import { quoteTransfer } from '../engine/transfer'
import { DISCOVERY_DESTINATIONS, dreamAirports } from '../jobs/discovery'
import { cachedSearch, itemToDealColumns, remainingSeats, searchDiagnostics, type CachedSearchResult } from '../providers/seats-aero'
import { loadAccount } from './account'
import { upsertDeal } from './deals'
import { evaluateMany } from './evaluation'
import { dayStart, logJob, requestsSince } from './usage'

const iata = z.string().regex(/^[A-Z]{3}$/, 'Use a 3-letter airport code')
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** "all" compares every cabin side by side. */
export const SEARCH_CABINS = ['all', ...CABINS] as const
export const MAX_SEATS = 4

export const awardSearchSchema = z
  .object({
    origin: iata,
    /** null searches every discovery destination ("Anywhere"). */
    destination: iata.nullable(),
    includeHomeAirports: z.boolean(),
    cabin: z.enum(SEARCH_CABINS),
    startDate: isoDate,
    endDate: isoDate,
    /** A round trip also searches the way back, over its own dates. */
    tripType: z.enum(['one_way', 'round_trip']).default('one_way'),
    returnStart: isoDate.nullable().default(null),
    returnEnd: isoDate.nullable().default(null),
    /** Seats needed on the same flight (people traveling together). */
    seats: z.number().int().min(1).max(MAX_SEATS).default(1),
    /** Only awards flown (at least partly) by this airline; null = any. */
    airline: z.enum(AWARD_AIRLINE_CODES).nullable().default(null),
    /** Only awards bookable with this Chase partner program; null = any. */
    program: z.enum(AWARD_PROGRAM_IDS).nullable().default(null),
  })
  .refine((v) => v.endDate >= v.startDate, { message: 'The end date must be on or after the start date', path: ['endDate'] })
  .refine((v) => v.tripType === 'one_way' || v.destination != null, { message: 'A round trip needs a "To" airport.', path: ['destination'] })
  .refine((v) => v.tripType === 'one_way' || (v.returnStart != null && v.returnEnd != null), { message: 'Choose the dates you could fly back.', path: ['returnStart'] })
  .refine((v) => v.tripType === 'one_way' || v.returnStart == null || v.returnEnd == null || v.returnEnd >= v.returnStart, {
    message: 'The last return date must be on or after the first.',
    path: ['returnEnd'],
  })
  .refine((v) => v.tripType === 'one_way' || v.returnEnd == null || v.returnEnd >= v.startDate, { message: 'The return dates must be after you leave.', path: ['returnEnd'] })

/** Trip type, cabin choice, seats and filters are optional for callers. */
export type AwardSearchInput = z.input<typeof awardSearchSchema>

/** A Chase transfer bonus to the program that books this award. */
export interface TransferBonusFlag {
  percent: number
  partnerName: string
  /** When the bonus ends (ISO), if known, and the time zone its deadline is set in. */
  endsAt: string | null
  endsAtTimezone: string | null
  verification: TransferPromotion['verificationStatus']
  sourceUrl: string | null
  /** Chase points the same award would take without the bonus. */
  chasePointsWithout: number | null
}

export interface AwardSearchResultRow {
  dealId: string
  cabin: Cabin
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
  /** Seats left at this price, or null when the program does not report it. */
  seats: number | null
  /** Chase points after the card's transfer ratio and any active Chase bonus. */
  chasePoints: number | null
  /** Comparable cash price when one is known (e.g. from an earlier lookup). */
  cashUsd: number | null
  /** Practical cents per Chase point when the value can be calculated. */
  cpp: number | null
  /** Whether a cash lookup was already tried recently without a match. */
  cashLookupTried: boolean
  bonus: TransferBonusFlag | null
}

/** One date (or one city and month, for "Anywhere") with the cheapest option in each cabin. */
export interface CabinCompareRow {
  key: string
  origin: string
  airport: string
  city: string
  country: string
  /** A travel date, or a month (YYYY-MM) when comparing many destinations. */
  when: string
  cells: Partial<Record<Cabin, AwardSearchResultRow>>
}

export interface AwardLegResult {
  /** Cheapest first; every cabin's options when comparing cabins. */
  results: AwardSearchResultRow[]
  /** Cabins side by side, when comparing every cabin. */
  compare: CabinCompareRow[] | null
  /** Options (or compared dates) found before trimming the list. */
  total: number
}

/** The cheapest way there and back in one cabin, as two one-way awards. */
export interface RoundTripPick {
  cabin: Cabin
  out: AwardSearchResultRow
  back: AwardSearchResultRow
  /** Per person. */
  points: number
  chasePoints: number | null
  taxesUsd: number | null
}

export type AwardSearchOutcome =
  | ({
      ok: true
      anywhere: boolean
      allCabins: boolean
      roundTrip: boolean
      seats: number
      /** The way back, for round trips. */
      returnLeg: AwardLegResult | null
      /** Best round trip in each cabin that has seats both ways. */
      roundTrips: RoundTripPick[]
      /** Options left out because fewer seats were reported than needed. */
      hiddenForSeats: number
      created: number
      requests: number
      truncated: boolean
      failed: number
    } & AwardLegResult)
  | { ok: false; error: string }

const RESULT_LIMIT = 60
const COMPARE_ROW_LIMIT = 30
const CONCURRENCY = 4

async function inBatches<T, R>(items: readonly T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))))
  return out
}

type Columns = NonNullable<ReturnType<typeof itemToDealColumns>>

interface Option {
  cols: Columns
  cabin: Cabin
  seats: number | null
  /** Chase points (ratio and active bonus applied); program points when the program is unknown. */
  cost: number
  chasePoints: number | null
  bonus: TransferBonusFlag | null
}

interface Request {
  leg: 'out' | 'back'
  origins: string[]
  destinations: string[]
  startDate: string
  endDate: string
}

function byCost(a: Option, b: Option): number {
  return (
    a.cost - b.cost ||
    Number(b.cols.flight?.stops === 0) - Number(a.cols.flight?.stops === 0) ||
    (a.cols.mandatoryCashUsd ?? Infinity) - (b.cols.mandatoryCashUsd ?? Infinity) ||
    (a.cols.travelStart ?? '').localeCompare(b.cols.travelStart ?? '') ||
    (a.cols.destCity ?? '').localeCompare(b.cols.destCity ?? '')
  )
}

/** The cheapest option for each key. */
function cheapestBy(options: readonly Option[], key: (o: Option) => string): Map<string, Option> {
  const out = new Map<string, Option>()
  for (const o of options) {
    const k = key(o)
    const cur = out.get(k)
    if (!cur || byCost(o, cur) < 0) out.set(k, o)
  }
  return out
}

interface ChosenLeg {
  list: Option[]
  rows: { key: string; when: string; cells: Partial<Record<Cabin, Option>> }[] | null
  total: number
}

/** Picks what to show for one direction: a cheapest-first list, or cabins side by side. */
function chooseLeg(options: readonly Option[], opts: { anywhere: boolean; allCabins: boolean; limit: number; rowLimit: number }): ChosenLeg {
  const month = (o: Option) => (o.cols.travelStart ?? '').slice(0, 7)
  // "Anywhere" keeps the cheapest date per city, cabin and month; one route keeps every date.
  const pool = opts.anywhere ? [...cheapestBy(options, (o) => `${o.cols.destCity}|${o.cabin}|${month(o)}`).values()] : [...options]
  if (!opts.allCabins) {
    pool.sort(byCost)
    return { list: pool.slice(0, opts.limit), rows: null, total: pool.length }
  }
  const rowKey = (o: Option) => (opts.anywhere ? `${o.cols.destCity}|${month(o)}` : `${o.cols.originAirport}|${o.cols.destAirport}|${o.cols.travelStart}`)
  const rows = new Map<string, { key: string; when: string; cells: Partial<Record<Cabin, Option>> }>()
  for (const [k, o] of cheapestBy(pool, (o) => `${rowKey(o)}|${o.cabin}`)) {
    const key = k.slice(0, k.lastIndexOf('|'))
    const row = rows.get(key) ?? { key, when: opts.anywhere ? month(o) : (o.cols.travelStart ?? ''), cells: {} }
    row.cells[o.cabin] = o
    rows.set(key, row)
  }
  const cheapestCell = (r: { cells: Partial<Record<Cabin, Option>> }) => Object.values(r.cells).sort(byCost)[0]!
  const sorted = [...rows.values()].sort((a, b) => byCost(cheapestCell(a), cheapestCell(b)))
  const shown = sorted.slice(0, opts.rowLimit)
  return { list: shown.flatMap((r) => Object.values(r.cells)).sort(byCost), rows: shown, total: sorted.length }
}

/** Cheapest pair per cabin where the way back is on or after the way out. */
function bestRoundTrips(outs: readonly Option[], backs: readonly Option[]): { cabin: Cabin; out: Option; back: Option }[] {
  const picks: { cabin: Cabin; out: Option; back: Option }[] = []
  for (const cabin of CABINS) {
    const o = outs.filter((x) => x.cabin === cabin)
    // Latest date first, so a running minimum gives the cheapest return on or after each date.
    const b = backs.filter((x) => x.cabin === cabin).sort((x, y) => (y.cols.travelStart ?? '').localeCompare(x.cols.travelStart ?? ''))
    if (!o.length || !b.length) continue
    const suffix: { date: string; best: Option }[] = []
    let best: Option | null = null
    for (const x of b) {
      if (!best || byCost(x, best) < 0) best = x
      suffix.push({ date: x.cols.travelStart ?? '', best })
    }
    let pick: { out: Option; back: Option } | null = null
    for (const out of o) {
      const date = out.cols.travelStart ?? ''
      // The last entry still on or after this date holds the cheapest of all those returns.
      let found: Option | null = null
      for (const s of suffix) {
        if (s.date >= date) found = s.best
        else break
      }
      if (!found) continue
      if (!pick || out.cost + found.cost < pick.out.cost + pick.back.cost) pick = { out, back: found }
    }
    if (pick) picks.push({ cabin, ...pick })
  }
  return picks
}

/**
 * Owner-requested award search through seats.aero's cached search. With no
 * destination it checks every discovery destination group from the origin
 * (one request per group) and keeps the cheapest date per city and month.
 * It can compare every cabin at once, add the way back for a round trip,
 * leave out flights with too few seats, and flag Chase transfer bonuses.
 */
export async function runAwardSearch(db: AppDb, userId: string, apiKey: string, rawInput: AwardSearchInput, opts: { now?: Date; fetch?: typeof fetch } = {}): Promise<AwardSearchOutcome> {
  const parsed = awardSearchSchema.safeParse(rawInput)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the search' }
  const input = parsed.data
  const now = opts.now ?? new Date()
  const doFetch = opts.fetch ?? fetch
  const [src] = await db.select().from(dataSources).where(eq(dataSources.id, 'seats_aero'))
  if (src && !src.enabled) return { ok: false, error: 'seats.aero is disabled in data sources.' }
  const account = await loadAccount(db, userId)
  const origins = input.includeHomeAirports ? [...new Set([input.origin, ...account.profile.homeAirports])].slice(0, 8) : [input.origin]
  const anywhere = input.destination == null
  const allCabins = input.cabin === 'all'
  const roundTrip = input.tripType === 'round_trip'
  const cabins: Cabin[] = allCabins ? [...CABINS] : [input.cabin as Cabin]
  const dreams = dreamAirports(account.profile.dreamDestinations)
  const groups = anywhere ? [...(dreams.length ? [dreams] : []), ...DISCOVERY_DESTINATIONS.map((g) => g.airports)] : [[input.destination!]]
  const requests: Request[] = groups.map((destinations) => ({ leg: 'out', origins, destinations, startDate: input.startDate, endDate: input.endDate }))
  if (roundTrip) requests.push({ leg: 'back', origins: [input.destination!], destinations: origins, startDate: input.returnStart!, endDate: input.returnEnd! })

  if (!withinQuota(await requestsSince(db, 'seats_aero', dayStart(now)), requests.length, src?.dailyQuota ?? 1000)) {
    await logJob(db, { provider: 'seats_aero', jobType: 'user_search', params: { ...input }, status: 'skipped_quota', startedAt: now, error: 'Daily quota reached' })
    return { ok: false, error: 'Daily seats.aero request limit reached. Try again tomorrow.' }
  }

  const responses = await inBatches(requests, CONCURRENCY, async (req) => {
    const startedAt = new Date()
    const params = { origins: req.origins, destinations: req.destinations, cabin: allCabins ? null : (input.cabin as Cabin), startDate: req.startDate, endDate: req.endDate }
    const logged = { ...params, cabin: params.cabin ?? 'all', leg: req.leg }
    try {
      const res = await cachedSearch(apiKey, params, doFetch)
      await logJob(db, {
        provider: 'seats_aero',
        jobType: 'user_search',
        params: { ...logged, ...searchDiagnostics(res) },
        status: 'succeeded',
        startedAt,
        requestCount: res.requests,
        estimatedCostUsd: src?.costPerRequestUsd ?? 0,
        resultsCount: res.items.length,
      })
      return { req, res }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Search failed'
      await logJob(db, { provider: 'seats_aero', jobType: 'user_search', params: logged, status: 'failed', startedAt, requestCount: 1, error: message })
      return { req, error: message }
    }
  })
  const failures = responses.filter((r): r is { req: Request; error: string } => 'error' in r)
  if (failures.length === responses.length) return { ok: false, error: failures[0]?.error ?? 'Search failed' }

  // Chase points per option (ratio and any active, non-targeted Chase bonus), for ranking and the bonus flag.
  const partners = new Map((await db.select().from(transferPartners)).map((r) => [r.id, partnerFromRow(r)]))
  const promotions = (await db.select().from(transferPromotions)).map(promotionFromRow)
  const card = account.wallet.cardType as CardType
  const priced = (programId: string, programPoints: number) => {
    const q = quoteTransfer({ programId, programPoints, partners, promotions, card, at: now })
    if (!q) return { chasePoints: null, bonus: null }
    const promo = q.bonusSource === 'promotion' ? q.promotion : null
    const bonus: TransferBonusFlag | null = promo
      ? {
          percent: q.bonusPercent,
          partnerName: q.partnerName ?? programId,
          endsAt: promo.endsAt?.toISOString() ?? null,
          endsAtTimezone: promo.endsAtTimezone,
          verification: promo.verificationStatus,
          sourceUrl: promo.sourceUrl,
          chasePointsWithout: quoteTransfer({ programId, programPoints, partners, promotions: [], card, at: now })?.requirement.chasePoints ?? null,
        }
      : null
    return { chasePoints: q.requirement.chasePoints, bonus }
  }

  const options: Record<Request['leg'], Option[]> = { out: [], back: [] }
  let truncated = false
  let hiddenForSeats = 0
  for (const r of responses) {
    if (!('res' in r)) continue
    const res = r.res as CachedSearchResult
    truncated ||= res.truncated
    for (const item of res.items) {
      for (const cabin of cabins) {
        const cols = itemToDealColumns(item, cabin)
        if (!cols || !cols.originAirport || !r.req.origins.includes(cols.originAirport) || !r.req.destinations.includes(cols.destAirport ?? '')) continue
        if (input.program && cols.programId !== input.program) continue
        if (input.airline && !airlineCodes(cols.flight?.operatingAirline).includes(input.airline)) continue
        const seats = remainingSeats(item, cabin)
        if (seats != null && seats < input.seats) {
          hiddenForSeats++
          continue
        }
        const { chasePoints, bonus } = priced(cols.programId ?? '', cols.programPoints ?? 0)
        options[r.req.leg].push({ cols, cabin, seats, cost: chasePoints ?? cols.programPoints ?? Infinity, chasePoints, bonus })
      }
    }
  }

  const legOpts = { anywhere, allCabins, limit: roundTrip ? RESULT_LIMIT / 2 : RESULT_LIMIT, rowLimit: roundTrip ? COMPARE_ROW_LIMIT / 2 : COMPARE_ROW_LIMIT }
  const out = chooseLeg(options.out, legOpts)
  const back = roundTrip ? chooseLeg(options.back, legOpts) : null
  const pairs = roundTrip ? bestRoundTrips(options.out, options.back) : []

  // Save only what is shown (every option would be thousands of rows with all cabins).
  const rowsByKey = new Map<string, AwardSearchResultRow>()
  let created = 0
  const save = async (o: Option): Promise<AwardSearchResultRow> => {
    const known = rowsByKey.get(o.cols.dedupeKey)
    if (known) return known
    const { verifiedAt, ...cols } = o.cols
    const up = await upsertDeal(db, cols, { now, verified: true, verifiedAt: verifiedAt ?? now, historySource: 'seats_aero' })
    if (up.isNew) created++
    const row: AwardSearchResultRow = {
      dealId: up.id,
      cabin: o.cabin,
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
      seats: o.seats,
      chasePoints: o.chasePoints,
      cashUsd: null,
      cpp: null,
      cashLookupTried: false,
      bonus: o.bonus,
    }
    rowsByKey.set(o.cols.dedupeKey, row)
    return row
  }
  const toLeg = async (leg: ChosenLeg): Promise<AwardLegResult> => {
    const results: AwardSearchResultRow[] = []
    for (const o of leg.list) results.push(await save(o))
    const compare = leg.rows
      ? await Promise.all(
          leg.rows.map(async (r) => {
            const cells: CabinCompareRow['cells'] = {}
            for (const [cabin, o] of Object.entries(r.cells) as [Cabin, Option][]) cells[cabin] = await save(o)
            const first = Object.values(cells)[0]!
            return { key: r.key, origin: first.origin, airport: first.airport, city: first.city, country: first.country, when: r.when, cells }
          }),
        )
      : null
    return { results, compare, total: leg.total }
  }
  const outLeg = await toLeg(out)
  const returnLeg = back ? await toLeg(back) : null
  const pairRows: { cabin: Cabin; out: AwardSearchResultRow; back: AwardSearchResultRow }[] = []
  for (const p of pairs) pairRows.push({ cabin: p.cabin, out: await save(p.out), back: await save(p.back) })

  // Value what is shown: ¢/pt where a cash price is already known.
  const shown = [...rowsByKey.values()]
  const values = await evaluateMany(db, userId, shown.map((r) => r.dealId), now)
  for (const r of shown) {
    const e = values.get(r.dealId)
    if (!e) continue
    r.chasePoints = e.valuation.chasePoints ?? r.chasePoints
    r.cashUsd = e.deal.comparableCashUsd
    r.cpp = e.valuation.calculable ? (e.valuation.practicalCpp ?? e.valuation.headlineCpp) : null
    r.cashLookupTried = e.deal.comparableCashUsd == null && e.deal.comparableCashObservedAt != null
  }
  const roundTrips: RoundTripPick[] = pairRows.map(({ cabin, out: o, back: b }) => ({
    cabin,
    out: o,
    back: b,
    points: o.points + b.points,
    chasePoints: o.chasePoints != null && b.chasePoints != null ? o.chasePoints + b.chasePoints : null,
    taxesUsd: o.taxesUsd != null && b.taxesUsd != null ? o.taxesUsd + b.taxesUsd : null,
  }))
  await db.insert(searchHistory).values({ userId, context: anywhere ? 'award_search_anywhere' : 'award_search', query: { ...input, origins } })
  return {
    ok: true,
    anywhere,
    allCabins,
    roundTrip,
    seats: input.seats,
    ...outLeg,
    returnLeg,
    roundTrips,
    hiddenForSeats,
    created,
    requests: responses.reduce((n, r) => n + ('res' in r && r.res ? r.res.requests : 1), 0),
    truncated,
    failed: failures.length,
  }
}
