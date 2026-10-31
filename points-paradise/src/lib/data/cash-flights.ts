import { z } from 'zod'
import type { AppDb } from '../db/client'
import { CABINS } from '../domain/constants'
import { searchCashFares, type CashFareSearch } from '../providers/serpapi'
import { lookupError, serpApiGate } from './cash-prices'
import { logJob } from './usage'

const iata = z.preprocess((v) => (typeof v === 'string' ? v.trim().toUpperCase() : v), z.string().regex(/^[A-Z]{3}$/, 'Use 3-letter airport codes, like LAX'))
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date')

export const cashSearchSchema = z
  .object({
    from: iata,
    to: iata,
    date: isoDate,
    returnDate: z.preprocess((v) => (v === '' ? null : v), isoDate.nullable().default(null)),
    cabin: z.enum(CABINS),
    adults: z.coerce.number().int().min(1).max(6).default(1),
    nonstop: z.boolean().default(false),
  })
  .refine((v) => v.from !== v.to, { message: 'From and To are the same airport', path: ['to'] })
  .refine((v) => !v.returnDate || v.returnDate >= v.date, { message: 'The return is before the departure', path: ['returnDate'] })

export type CashSearchInput = z.infer<typeof cashSearchSchema>

export type CashSearchOutcome = ({ ok: true } & CashFareSearch) | { ok: false; error: string }

/** Cash fares from Google Flights (one SerpApi search, within the monthly allowance). */
export async function searchCashFlights(db: AppDb, input: CashSearchInput, deps: { apiKey: string; now: Date; fetch: typeof fetch; monthlyCapUsd: number }): Promise<CashSearchOutcome> {
  if (input.date < deps.now.toISOString().slice(0, 10)) return { ok: false, error: 'Choose a date from today on.' }
  const params = { ...input }
  const gate = await serpApiGate(db, { provider: 'serpapi_flights', jobType: 'cash_search', params, now: deps.now, monthlyCapUsd: deps.monthlyCapUsd })
  if (!gate.ok) return { ok: false, error: gate.reason }
  const startedAt = new Date()
  try {
    const r = await searchCashFares(deps.apiKey, input, deps.fetch)
    await logJob(db, { provider: 'serpapi_flights', jobType: 'cash_search', params, status: 'succeeded', startedAt, requestCount: 1, estimatedCostUsd: gate.costUsd, resultsCount: r?.itineraries.length ?? 0 })
    if (!r || !r.itineraries.length) return { ok: false, error: `Google Flights has no ${input.nonstop ? 'nonstop ' : ''}fares from ${input.from} to ${input.to} on that day.` }
    return { ok: true, ...r }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Search failed'
    await logJob(db, { provider: 'serpapi_flights', jobType: 'cash_search', params, status: 'failed', startedAt, requestCount: 1, error: message })
    return { ok: false, error: lookupError(message).replace('The cash-price lookup failed', 'The search failed') }
  }
}
