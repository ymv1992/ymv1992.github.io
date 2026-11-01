import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { AppDb } from '../db/client'
import { dataSources } from '../db/schema'
import { CABINS, type Cabin, type CardType } from '../domain/constants'
import { withinQuota } from '../engine/budget'
import { getAirport } from '../geo/airports'
import { DISCOVERY_DESTINATIONS, dreamAirports } from '../jobs/discovery'
import { cachedSearch, itemToDealColumns, remainingSeats, searchDiagnostics, type CachedSearchResult } from '../providers/seats-aero'
import { loadAccount } from './account'
import { chasePricer, type AwardSearchResultRow, type TransferBonusFlag } from './award-search'
import { upsertDeal } from './deals'
import { dayStart, logJob, requestsSince } from './usage'

const iata = z.string().regex(/^[A-Z]{3}$/, 'Use a 3-letter airport code')

export const weekendSchema = z.object({
  origin: iata,
  includeHomeAirports: z.boolean().default(true),
  /** How many weekends ahead to look. */
  weeks: z.coerce.number().int().min(2).max(12).default(8),
  /** short: out Friday, back Sunday. long: out Thursday or Friday, back Sunday or Monday. */
  shape: z.enum(['short', 'long']).default('long'),
  cabin: z.enum(CABINS).default('economy'),
  seats: z.coerce.number().int().min(1).max(4).default(1),
  /** Longest flight to consider, in miles; null = any distance. */
  maxMiles: z.coerce.number().int().min(300).max(10_000).nullable().default(2500),
})

export type WeekendInput = z.input<typeof weekendSchema>

export interface WeekendWindow {
  /** "Thu Nov 5 – Mon Nov 9" */
  label: string
  friday: string
  outDates: string[]
  backDates: string[]
}

function plus(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
}

const short = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })

/** The coming weekends, starting with the next Friday after today; travel days already past are left out. */
export function weekendWindows(today: string, weeks: number, shape: 'short' | 'long'): WeekendWindow[] {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay()
  const toFriday = (5 - dow + 7) % 7 || 7
  const out: WeekendWindow[] = []
  for (let w = 0; w < weeks; w++) {
    const friday = plus(today, toFriday + 7 * w)
    const outDates = (shape === 'long' ? [plus(friday, -1), friday] : [friday]).filter((d) => d > today)
    const backDates = shape === 'long' ? [plus(friday, 2), plus(friday, 3)] : [plus(friday, 2)]
    out.push({ label: `${short(outDates[0]!)} – ${short(backDates.at(-1)!)}`, friday, outDates, backDates })
  }
  return out
}

export interface WeekendPick {
  city: string
  country: string
  airport: string
  out: AwardSearchResultRow
  back: AwardSearchResultRow
  /** Per person, both ways. */
  points: number
  chasePoints: number | null
  taxesUsd: number | null
  miles: number | null
}

export type WeekendOutcome =
  | {
      ok: true
      windows: (WeekendWindow & { picks: WeekendPick[] })[]
      requests: number
      failed: number
      truncated: boolean
      hiddenForSeats: number
      /** Destinations with seats both ways on some weekend. */
      destinations: number
    }
  | { ok: false; error: string }

const PICKS_PER_WEEKEND = 6

interface Option {
  cols: NonNullable<ReturnType<typeof itemToDealColumns>>
  seats: number | null
  cost: number
  chasePoints: number | null
  bonus: TransferBonusFlag | null
  miles: number | null
}

/**
 * Award seats for weekend trips from the owner's home airports: for each of
 * the coming weekends, the cheapest way out (Thursday/Friday) and back
 * (Sunday/Monday) to each destination, in Chase points. Uses seats.aero's
 * cached search, one request per destination group each way.
 */
export async function findWeekendGetaways(db: AppDb, userId: string, apiKey: string, raw: WeekendInput, opts: { now?: Date; fetch?: typeof fetch } = {}): Promise<WeekendOutcome> {
  const parsed = weekendSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the search' }
  const input = parsed.data
  const now = opts.now ?? new Date()
  const doFetch = opts.fetch ?? fetch
  const [src] = await db.select().from(dataSources).where(eq(dataSources.id, 'seats_aero'))
  if (src && !src.enabled) return { ok: false, error: 'seats.aero is disabled in data sources.' }
  const account = await loadAccount(db, userId)
  const origins = input.includeHomeAirports ? [...new Set([input.origin, ...account.profile.homeAirports])].slice(0, 8) : [input.origin]
  const windows = weekendWindows(now.toISOString().slice(0, 10), input.weeks, input.shape).filter((w) => w.outDates.length)
  if (!windows.length) return { ok: false, error: 'No weekends to search.' }
  const dreams = dreamAirports(account.profile.dreamDestinations)
  const groups = [...(dreams.length ? [dreams] : []), ...DISCOVERY_DESTINATIONS.map((g) => g.airports)].map((g) => g.filter((a) => !origins.includes(a))).filter((g) => g.length)
  const firstOut = windows[0]!.outDates[0]!
  const lastOut = windows.at(-1)!.outDates.at(-1)!
  const firstBack = windows[0]!.backDates[0]!
  const lastBack = windows.at(-1)!.backDates.at(-1)!
  const requests = groups.flatMap((g) => [
    { leg: 'out' as const, origins, destinations: g, startDate: firstOut, endDate: lastOut },
    { leg: 'back' as const, origins: g, destinations: origins, startDate: firstBack, endDate: lastBack },
  ])
  if (!withinQuota(await requestsSince(db, 'seats_aero', dayStart(now)), requests.length, src?.dailyQuota ?? 1000)) {
    await logJob(db, { provider: 'seats_aero', jobType: 'weekend_search', params: { ...input }, status: 'skipped_quota', startedAt: now, error: 'Daily quota reached' })
    return { ok: false, error: 'Daily seats.aero request limit reached. Try again tomorrow.' }
  }

  const responses: ({ req: (typeof requests)[number]; res: CachedSearchResult } | { req: (typeof requests)[number]; error: string })[] = []
  for (let i = 0; i < requests.length; i += 4) {
    responses.push(
      ...(await Promise.all(
        requests.slice(i, i + 4).map(async (req) => {
          const startedAt = new Date()
          const params = { origins: req.origins, destinations: req.destinations, cabin: input.cabin as Cabin, startDate: req.startDate, endDate: req.endDate }
          try {
            const res = await cachedSearch(apiKey, params, doFetch)
            await logJob(db, {
              provider: 'seats_aero',
              jobType: 'weekend_search',
              params: { ...params, leg: req.leg, ...searchDiagnostics(res) },
              status: 'succeeded',
              startedAt,
              requestCount: res.requests,
              estimatedCostUsd: src?.costPerRequestUsd ?? 0,
              resultsCount: res.items.length,
            })
            return { req, res }
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Search failed'
            await logJob(db, { provider: 'seats_aero', jobType: 'weekend_search', params: { ...params, leg: req.leg }, status: 'failed', startedAt, requestCount: 1, error: message })
            return { req, error: message }
          }
        }),
      )),
    )
  }
  const failed = responses.filter((r) => 'error' in r).length
  if (failed === responses.length) return { ok: false, error: (responses[0] as { error: string }).error }

  const priced = await chasePricer(db, account.wallet.cardType as CardType, now)
  const out: Option[] = []
  const back: Option[] = []
  let truncated = false
  let hiddenForSeats = 0
  for (const r of responses) {
    if (!('res' in r)) continue
    truncated ||= r.res.truncated
    for (const item of r.res.items) {
      const cols = itemToDealColumns(item, input.cabin)
      if (!cols?.originAirport || !cols.destAirport || !r.req.origins.includes(cols.originAirport) || !r.req.destinations.includes(cols.destAirport)) continue
      const miles = item.Route.Distance ?? null
      if (input.maxMiles != null && miles != null && miles > input.maxMiles) continue
      const seats = remainingSeats(item, input.cabin)
      if (seats != null && seats < input.seats) {
        hiddenForSeats++
        continue
      }
      const { chasePoints, bonus } = priced(cols.programId ?? '', cols.programPoints ?? 0)
      ;(r.req.leg === 'out' ? out : back).push({ cols, seats, cost: chasePoints ?? cols.programPoints ?? Infinity, chasePoints, bonus, miles })
    }
  }

  // Per weekend and destination city: the cheapest way out and the cheapest way back.
  const cheapest = (list: Option[]) => list.reduce<Option | null>((a, b) => (!a || b.cost < a.cost || (b.cost === a.cost && (b.cols.mandatoryCashUsd ?? 1e9) < (a.cols.mandatoryCashUsd ?? 1e9)) ? b : a), null)
  const cityOf = (airport: string) => getAirport(airport)?.city ?? airport
  const reached = new Set<string>()
  const chosen = windows.map((w) => {
    const byCity = new Map<string, { o: Option; b: Option }>()
    const outsByCity = new Map<string, Option[]>()
    for (const o of out) if (w.outDates.includes(o.cols.travelStart ?? '')) outsByCity.set(cityOf(o.cols.destAirport!), [...(outsByCity.get(cityOf(o.cols.destAirport!)) ?? []), o])
    for (const [city, outs] of outsByCity) {
      const o = cheapest(outs)
      const b = cheapest(back.filter((x) => w.backDates.includes(x.cols.travelStart ?? '') && cityOf(x.cols.originAirport!) === city))
      if (o && b) byCity.set(city, { o, b })
    }
    const picks = [...byCity.entries()].sort((x, y) => x[1].o.cost + x[1].b.cost - (y[1].o.cost + y[1].b.cost)).slice(0, PICKS_PER_WEEKEND)
    for (const [city] of byCity) reached.add(city)
    return { w, picks }
  })

  // Save only the flights shown, so each has its own page (cash price, value, add to a trip).
  const rows = new Map<string, AwardSearchResultRow>()
  const save = async (o: Option): Promise<AwardSearchResultRow> => {
    const known = rows.get(o.cols.dedupeKey)
    if (known) return known
    const { verifiedAt, ...cols } = o.cols
    const up = await upsertDeal(db, cols, { now, verified: true, verifiedAt: verifiedAt ?? now, historySource: 'seats_aero' })
    const row: AwardSearchResultRow = {
      dealId: up.id,
      cabin: input.cabin,
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
    rows.set(o.cols.dedupeKey, row)
    return row
  }
  const result: (WeekendWindow & { picks: WeekendPick[] })[] = []
  for (const { w, picks } of chosen) {
    const list: WeekendPick[] = []
    for (const [city, { o, b }] of picks) {
      const outRow = await save(o)
      const backRow = await save(b)
      list.push({
        city,
        country: outRow.country,
        airport: outRow.airport,
        out: outRow,
        back: backRow,
        points: outRow.points + backRow.points,
        // Same program both ways: one transfer covers both, rounded once.
        chasePoints: outRow.programId === backRow.programId ? priced(outRow.programId, outRow.points + backRow.points).chasePoints : o.chasePoints != null && b.chasePoints != null ? o.chasePoints + b.chasePoints : null,
        taxesUsd: outRow.taxesUsd != null && backRow.taxesUsd != null ? outRow.taxesUsd + backRow.taxesUsd : null,
        miles: o.miles,
      })
    }
    result.push({ ...w, picks: list })
  }
  return { ok: true, windows: result, requests: responses.reduce((n, r) => n + ('res' in r ? r.res.requests : 1), 0), failed, truncated, hiddenForSeats, destinations: reached.size }
}
