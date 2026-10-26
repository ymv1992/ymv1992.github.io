import { and, eq, gte, inArray, lte } from 'drizzle-orm'
import type { AppDb } from '../db/client'
import { appState, dataSources, deals } from '../db/schema'
import type { Cabin } from '../domain/constants'
import { loadAccount } from '../data/account'
import { upsertDeal } from '../data/deals'
import { dayStart, logJob, requestsSince } from '../data/usage'
import { getAirport, searchAirports } from '../geo/airports'
import { cachedSearch, itemToDealColumns, searchDiagnostics } from '../providers/seats-aero'

/**
 * Automatic award discovery: searches seats.aero's cached availability from
 * the owner's home airports to a fixed list of popular award destinations
 * (plus resolvable dream destinations), so Discover fills itself.
 *
 * Cost: seats.aero Pro includes API calls (1,000/day). Discovery uses at most
 * DISCOVERY_DAILY_CAP of them and always leaves QUOTA_RESERVE for watches and
 * manual searches, so it never adds cost beyond the subscription.
 */

export const DISCOVERY_DESTINATIONS: { id: string; label: string; airports: string[] }[] = [
  { id: 'east-asia', label: 'Japan, Korea, Taiwan, Hong Kong', airports: ['NRT', 'HND', 'KIX', 'ICN', 'TPE', 'HKG'] },
  { id: 'southeast-asia', label: 'Southeast Asia', airports: ['SIN', 'BKK', 'DPS', 'MNL', 'SGN', 'KUL'] },
  { id: 'pacific-islands', label: 'Hawaii, Fiji, Tahiti', airports: ['HNL', 'OGG', 'KOA', 'LIH', 'NAN', 'PPT'] },
  { id: 'oceania', label: 'Australia and New Zealand', airports: ['SYD', 'MEL', 'BNE', 'AKL'] },
  { id: 'western-europe', label: 'Western Europe', airports: ['LHR', 'CDG', 'AMS', 'FRA', 'MUC', 'ZRH'] },
  { id: 'southern-europe', label: 'Southern Europe', airports: ['FCO', 'MXP', 'BCN', 'MAD', 'LIS', 'ATH'] },
  { id: 'northern-europe', label: 'Ireland, Iceland, Scandinavia, Central Europe', airports: ['DUB', 'EDI', 'KEF', 'CPH', 'VIE', 'PRG'] },
  { id: 'middle-east-africa', label: 'Middle East, Africa, Maldives', airports: ['DXB', 'DOH', 'IST', 'CPT', 'JNB', 'MLE'] },
  { id: 'mexico-central-america', label: 'Mexico and Costa Rica', airports: ['CUN', 'SJD', 'MEX', 'PVR', 'LIR', 'SJO'] },
  { id: 'south-america', label: 'South America', airports: ['LIM', 'SCL', 'EZE', 'GRU', 'GIG', 'BOG'] },
]

const DEFAULT_ORIGINS = ['SAN', 'LAX', 'SNA', 'ONT', 'BUR']
const DISCOVERY_CABINS: Cabin[] = ['economy', 'premium_economy', 'business', 'first']
export const DISCOVERY_DAILY_CAP = 100
/** seats.aero calls always left for route watches and Award Calendar searches. */
export const QUOTA_RESERVE = 200
/** Searches cover ~11 months in three windows so one 500-result page rarely truncates. */
const WINDOW_DAYS = 110
const WINDOWS = 3
/** Per destination city, cabin and month, keep this many of the cheapest dates. */
export const KEEP_PER_GROUP = 1
export const DISCOVERY_METHOD = 'seats.aero discovery'
const CURSOR_KEY = 'discovery:cursor'
const DAY = 86_400_000

export interface DiscoveryTask {
  groupId: string
  airports: string[]
  cabin: Cabin
  window: number
}

export interface DiscoveryLimits {
  maxCalls: number
  timeBudgetMs: number
}

export interface DiscoveryDeps {
  now: Date
  apiKey: string | null
  fetch: typeof fetch
}

export interface DiscoveryOutcome {
  calls: number
  newDeals: number
  updatedDeals: number
  markedUnavailable: number
  skipped: string[]
  errors: string[]
}

/** Dream destinations given as an IATA code or an exact city name; others are skipped. */
export function dreamAirports(dreams: readonly string[]): string[] {
  const listed = new Set(DISCOVERY_DESTINATIONS.flatMap((g) => g.airports))
  const out: string[] = []
  for (const raw of dreams) {
    const q = raw.trim()
    if (!q) continue
    const byCode = /^[A-Za-z]{3}$/.test(q) ? getAirport(q.toUpperCase()) : null
    const match = byCode ?? searchAirports(q, 10).find((a) => a.city.toLowerCase() === q.toLowerCase()) ?? null
    if (match && !listed.has(match.iata) && !out.includes(match.iata)) out.push(match.iata)
  }
  return out.slice(0, 6)
}

/** Every search in one full cycle, dream destinations first. */
export function discoveryTasks(cabins: readonly Cabin[], dreams: readonly string[]): DiscoveryTask[] {
  const groups = [...(dreams.length ? [{ id: 'dreams', airports: [...dreams] }] : []), ...DISCOVERY_DESTINATIONS]
  const tasks: DiscoveryTask[] = []
  for (let window = 0; window < WINDOWS; window++) {
    for (const g of groups) for (const cabin of cabins) tasks.push({ groupId: g.id, airports: g.airports, cabin, window })
  }
  return tasks
}

function windowDates(now: Date, window: number): { startDate: string; endDate: string } {
  const start = new Date(now.getTime() + (1 + window * WINDOW_DAYS) * DAY)
  const end = new Date(now.getTime() + (window + 1) * WINDOW_DAYS * DAY)
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) }
}

type Mapped = NonNullable<ReturnType<typeof itemToDealColumns>>

/** Cheapest KEEP_PER_GROUP dates per destination city, cabin and month; direct flights win ties. */
export function pickCheapest(items: readonly Mapped[], keep = KEEP_PER_GROUP): Mapped[] {
  const groups = new Map<string, Mapped[]>()
  for (const m of items) {
    const key = `${m.destCity}|${m.flight?.cabin}|${(m.travelStart ?? '').slice(0, 7)}`
    const list = groups.get(key) ?? []
    list.push(m)
    groups.set(key, list)
  }
  const out: Mapped[] = []
  for (const list of groups.values()) {
    list.sort(
      (a, b) =>
        (a.programPoints ?? Infinity) - (b.programPoints ?? Infinity) ||
        Number(b.flight?.stops === 0) - Number(a.flight?.stops === 0) ||
        (a.mandatoryCashUsd ?? Infinity) - (b.mandatoryCashUsd ?? Infinity) ||
        (a.travelStart ?? '').localeCompare(b.travelStart ?? ''),
    )
    out.push(...list.slice(0, keep))
  }
  return out
}

/**
 * Runs the next slice of the discovery cycle for one owner, stopping at the
 * call limit, the time budget, the daily cap or the shared quota reserve.
 */
export async function runDiscovery(db: AppDb, userId: string, deps: DiscoveryDeps, limits: DiscoveryLimits): Promise<DiscoveryOutcome> {
  const out: DiscoveryOutcome = { calls: 0, newDeals: 0, updatedDeals: 0, markedUnavailable: 0, skipped: [], errors: [] }
  const { now } = deps
  const account = await loadAccount(db, userId)
  if (!account.settings.discoveryEnabled) {
    out.skipped.push('Automatic discovery is turned off in Settings')
    return out
  }
  if (!deps.apiKey) {
    out.skipped.push('Automatic discovery: SEATS_AERO_API_KEY not set')
    return out
  }
  const [src] = await db.select().from(dataSources).where(eq(dataSources.id, 'seats_aero'))
  if (src && !src.enabled) {
    out.skipped.push('seats.aero disabled')
    return out
  }
  const cabins = account.settings.discoveryCabins.filter((c): c is Cabin => (DISCOVERY_CABINS as string[]).includes(c))
  if (cabins.length === 0) {
    out.skipped.push('Automatic discovery: no cabins selected')
    return out
  }
  const origins = (account.profile.homeAirports.length ? account.profile.homeAirports : DEFAULT_ORIGINS).slice(0, 8)
  const tasks = discoveryTasks(cabins, dreamAirports(account.profile.dreamDestinations))

  const quota = src?.dailyQuota ?? 1000
  const usedToday = await requestsSince(db, 'seats_aero', dayStart(now))
  const discoveryToday = await requestsSince(db, 'seats_aero', dayStart(now), 'discovery')
  const allowed = Math.min(limits.maxCalls, DISCOVERY_DAILY_CAP - discoveryToday, quota - QUOTA_RESERVE - usedToday, tasks.length)
  if (allowed <= 0) {
    out.skipped.push('Automatic discovery: daily limit reached')
    return out
  }

  const [cursorRow] = await db.select().from(appState).where(eq(appState.key, CURSOR_KEY))
  let cursor = Number((cursorRow?.value as { next?: number } | undefined)?.next ?? 0) % tasks.length
  const startedRun = Date.now()

  for (let i = 0; i < allowed; i++) {
    if (Date.now() - startedRun > limits.timeBudgetMs) break
    const task = tasks[cursor]!
    cursor = (cursor + 1) % tasks.length
    const { startDate, endDate } = windowDates(now, task.window)
    const startedAt = new Date()
    try {
      const res = await cachedSearch(deps.apiKey, { origins, destinations: task.airports, cabin: task.cabin, startDate, endDate }, deps.fetch)
      out.calls += res.requests
      const mapped = res.items
        .map((item) => itemToDealColumns(item, task.cabin))
        .filter((m): m is Mapped => m !== null && !!m.originAirport && origins.includes(m.originAirport) && task.airports.includes(m.destAirport ?? ''))
        .map((m) => ({ ...m, verificationMethod: DISCOVERY_METHOD, sourceName: DISCOVERY_METHOD }))
      const seen = new Set(mapped.map((m) => m.dedupeKey))

      const existing = (
        await db
          .select({ id: deals.id, dedupeKey: deals.dedupeKey, originAirport: deals.originAirport, flight: deals.flight })
          .from(deals)
          .where(
            and(
              eq(deals.verificationMethod, DISCOVERY_METHOD),
              eq(deals.availability, 'available'),
              inArray(deals.destAirport, task.airports),
              gte(deals.travelStart, startDate),
              lte(deals.travelStart, endDate),
            ),
          )
      ).filter((d) => d.flight?.cabin === task.cabin && d.originAirport != null && origins.includes(d.originAirport))
      const existingKeys = new Set(existing.map((d) => d.dedupeKey))

      // Keep the cheapest dates, and keep refreshing anything already shown that is still available.
      const keep = new Map<string, Mapped>()
      for (const m of pickCheapest(mapped)) keep.set(m.dedupeKey, m)
      for (const m of mapped) if (existingKeys.has(m.dedupeKey)) keep.set(m.dedupeKey, m)
      for (const m of keep.values()) {
        const { verifiedAt, ...cols } = m
        const up = await upsertDeal(db, cols, { now, verified: true, verifiedAt: verifiedAt ?? now, historySource: 'seats_aero' })
        if (up.isNew) out.newDeals++
        else out.updatedDeals++
      }

      // A full (untruncated) answer that no longer includes a shown award means it is gone;
      // it moves to History as "Award space disappeared" so pages only load live finds.
      if (!res.truncated) {
        const gone = existing.filter((d) => !seen.has(d.dedupeKey)).map((d) => d.id)
        if (gone.length) {
          await db
            .update(deals)
            .set({ availability: 'unavailable', lastVerifiedAt: now, archivedAt: now, archiveReason: 'availability_disappeared', updatedAt: now })
            .where(inArray(deals.id, gone))
          out.markedUnavailable += gone.length
        }
      }

      await logJob(db, {
        provider: 'seats_aero',
        jobType: 'discovery',
        params: { group: task.groupId, origins, destinations: task.airports, cabin: task.cabin, startDate, endDate, truncated: res.truncated, ...searchDiagnostics(res), matched: mapped.length },
        status: 'succeeded',
        startedAt,
        requestCount: res.requests,
        estimatedCostUsd: src?.costPerRequestUsd ?? 0,
        resultsCount: keep.size,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Discovery search failed'
      out.calls += 1
      out.errors.push(`discovery ${task.groupId}/${task.cabin}: ${message}`)
      await logJob(db, { provider: 'seats_aero', jobType: 'discovery', params: { group: task.groupId, cabin: task.cabin }, status: 'failed', startedAt, requestCount: 1, error: message })
      // An authorization problem will not fix itself within this run.
      if (/\b(401|403)\b/.test(message)) break
    }
  }

  await db
    .insert(appState)
    .values({ key: CURSOR_KEY, value: { next: cursor } })
    .onConflictDoUpdate({ target: appState.key, set: { value: { next: cursor }, updatedAt: now } })
  return out
}
