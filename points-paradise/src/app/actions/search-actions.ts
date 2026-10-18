'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { CABINS } from '@/lib/domain/constants'
import { dataSources, searchHistory } from '@/lib/db/schema'
import { upsertDeal } from '@/lib/data/deals'
import { dayStart, logJob, requestsSince } from '@/lib/data/usage'
import { withinQuota } from '@/lib/engine/budget'
import { cachedSearch, itemToDealColumns } from '@/lib/providers/seats-aero'
import { config } from '@/lib/server/config'
import { requireUserId } from '@/lib/server/session'
import { eq } from 'drizzle-orm'

export interface SearchState {
  error: string | null
  ok?: string
}

const iata = z.string().regex(/^[A-Z]{3}$/)

/** User-requested award search (highest priority in the queue), within the provider's daily quota. */
export async function searchAwardsAction(_prev: SearchState, fd: FormData): Promise<SearchState> {
  const userId = await requireUserId()
  const key = config.seatsAeroKey()
  if (!key) return { error: 'Award search needs a seats.aero Pro API key (SEATS_AERO_API_KEY). Until then, add deals manually.' }
  const parsed = z
    .object({
      origin: iata,
      destination: iata,
      cabin: z.enum(CABINS),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    .safeParse({
      origin: String(fd.get('origin') ?? '').toUpperCase(),
      destination: String(fd.get('destination') ?? '').toUpperCase(),
      cabin: fd.get('cabin'),
      startDate: fd.get('startDate'),
      endDate: fd.get('endDate'),
    })
  if (!parsed.success) return { error: 'Enter two airport codes, a cabin and a date range.' }
  const p = parsed.data
  const db = await getDb()
  const now = new Date()
  const [src] = await db.select().from(dataSources).where(eq(dataSources.id, 'seats_aero'))
  if (src && !src.enabled) return { error: 'seats.aero is disabled in data sources.' }
  if (!withinQuota(await requestsSince(db, 'seats_aero', dayStart(now)), 1, src?.dailyQuota ?? 1000)) {
    await logJob(db, { provider: 'seats_aero', jobType: 'user_search', params: p, status: 'skipped_quota', startedAt: now, error: 'Daily quota reached' })
    return { error: 'Daily seats.aero request quota reached. Try again tomorrow.' }
  }
  const startedAt = new Date()
  try {
    const res = await cachedSearch(key, { origins: [p.origin], destinations: [p.destination], cabin: p.cabin, startDate: p.startDate, endDate: p.endDate })
    const mapped = res.items.map((i) => itemToDealColumns(i, p.cabin)).filter((x): x is NonNullable<typeof x> => x !== null)
    let created = 0
    for (const m of mapped) {
      const { verifiedAt, ...cols } = m
      const r = await upsertDeal(db, cols, { now, verified: true, verifiedAt: verifiedAt ?? now, historySource: 'seats_aero' })
      if (r.isNew) created++
    }
    await logJob(db, { provider: 'seats_aero', jobType: 'user_search', params: p, status: 'succeeded', startedAt, requestCount: res.requests, estimatedCostUsd: src?.costPerRequestUsd ?? 0, resultsCount: mapped.length })
    await db.insert(searchHistory).values({ userId, context: 'award_search', query: p })
    revalidatePath('/', 'layout')
    return { error: null, ok: `${mapped.length} award dates found via Chase partners (${created} new). Cash comparisons are added by the daily job when SerpApi is configured, or enter them yourself.` }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Search failed'
    await logJob(db, { provider: 'seats_aero', jobType: 'user_search', params: p, status: 'failed', startedAt, requestCount: 1, error: message })
    return { error: message }
  }
}
