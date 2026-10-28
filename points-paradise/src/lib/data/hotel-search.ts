import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { AppDb } from '../db/client'
import { dataSources, searchHistory } from '../db/schema'
import { withinQuota } from '../engine/budget'
import { pickHotels } from '../jobs/hotel-discovery'
import { hotelDiagnostics, hotelRowToDeals, hotelSearch, ROOMS_PROGRAMS } from '../providers/rooms-aero'
import { upsertDeal } from './deals'
import { evaluateMany } from './evaluation'
import { dayStart, logJob, requestsSince } from './usage'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const hotelSearchSchema = z
  .object({
    place: z.string().trim().min(2, 'Enter a place, such as "Maui" or "Paris"').max(80),
    startDate: isoDate,
    endDate: isoDate,
    nights: z.coerce.number().int().min(1).max(5),
    programs: z.array(z.enum(Object.keys(ROOMS_PROGRAMS) as [string, ...string[]])).min(1, 'Choose at least one hotel program'),
  })
  .refine((v) => v.endDate >= v.startDate, { message: 'The last check-in date must be on or after the first', path: ['endDate'] })

export type HotelSearchInput = z.infer<typeof hotelSearchSchema>

export interface HotelSearchResultRow {
  dealId: string
  hotel: string
  brand: string
  city: string
  country: string
  checkIn: string
  nights: number
  room: 'standard' | 'suite'
  programId: string
  points: number
  chasePoints: number | null
  cashUsd: number | null
  cpp: number | null
}

export type HotelSearchOutcome = { ok: true; results: HotelSearchResultRow[]; total: number; created: number; placeFound: boolean } | { ok: false; error: string }

/** Hotels kept and shown per search, best value first. */
const KEEP = 25
/** rooms.aero calls left for other uses when an owner search is refused. */
const RESERVE = 20
const METHOD = 'rooms.aero search'

/** Owner-requested hotel award search through rooms.aero: one request for a place and check-in date range. */
export async function runHotelSearch(db: AppDb, userId: string, apiKey: string, input: HotelSearchInput, opts: { now?: Date; fetch?: typeof fetch } = {}): Promise<HotelSearchOutcome> {
  const now = opts.now ?? new Date()
  const [src] = await db.select().from(dataSources).where(eq(dataSources.id, 'rooms_aero'))
  if (src && !src.enabled) return { ok: false, error: 'rooms.aero is disabled in data sources.' }
  if (!withinQuota(await requestsSince(db, 'rooms_aero', dayStart(now)), 1, (src?.dailyQuota ?? 1000) - RESERVE)) {
    return { ok: false, error: "Today's rooms.aero lookups are used up. Try again tomorrow." }
  }
  const sources = input.programs.map((p) => ROOMS_PROGRAMS[p]!).filter(Boolean)
  const startedAt = new Date()
  let res
  try {
    res = await hotelSearch(apiKey, { location: input.place, startDate: input.startDate, endDate: input.endDate, nights: input.nights, sources }, opts.fetch ?? fetch)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Hotel search failed'
    await logJob(db, { provider: 'rooms_aero', jobType: 'user_hotel_search', params: { ...input }, status: 'failed', startedAt, requestCount: 1, error: message })
    return { ok: false, error: message }
  }
  const place = { label: input.place, region: 'north_america' as const, tags: [] }
  const kept = pickHotels(res.rows, KEEP).flatMap((row) => hotelRowToDeals(row, place, input.nights, METHOD))
  const results: HotelSearchResultRow[] = []
  let created = 0
  for (let i = 0; i < kept.length; i += 3) {
    await Promise.all(
      kept.slice(i, i + 3).map(async (d) => {
        const { verifiedAt, ...cols } = d
        const up = await upsertDeal(db, cols, { now, verified: true, verifiedAt: verifiedAt ?? now, historySource: 'rooms_aero' })
        if (up.isNew) created++
        results.push({
          dealId: up.id,
          hotel: d.hotel?.property ?? d.title,
          brand: d.providerName,
          city: d.destCity,
          country: d.destCountry,
          checkIn: d.travelStart ?? '',
          nights: d.nights ?? input.nights,
          room: d.hotel?.roomType === 'suite' ? 'suite' : 'standard',
          programId: d.programId,
          points: d.programPoints ?? 0,
          chasePoints: null,
          cashUsd: d.comparableCashUsd,
          cpp: null,
        })
      }),
    )
  }
  const values = await evaluateMany(db, userId, results.map((r) => r.dealId), now)
  for (const r of results) {
    const e = values.get(r.dealId)
    if (!e) continue
    r.chasePoints = e.valuation.chasePoints
    r.cpp = e.valuation.calculable ? (e.valuation.practicalCpp ?? e.valuation.headlineCpp) : null
  }
  results.sort((a, b) => (b.cpp ?? -1) - (a.cpp ?? -1) || (a.chasePoints ?? a.points) - (b.chasePoints ?? b.points))
  await logJob(db, {
    provider: 'rooms_aero',
    jobType: 'user_hotel_search',
    params: { ...input, ...hotelDiagnostics(res), matched: kept.length },
    status: 'succeeded',
    startedAt,
    requestCount: res.requests,
    estimatedCostUsd: 0,
    resultsCount: kept.length,
  })
  await db.insert(searchHistory).values({ userId, context: 'hotel_search', query: { ...input } })
  return { ok: true, results, total: results.length, created, placeFound: !res.locationNotFound }
}
