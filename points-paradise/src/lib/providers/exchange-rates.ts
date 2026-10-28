/**
 * Free daily exchange rates, no key: the European Central Bank's reference
 * rates through Frankfurter (about 30 major currencies), then the community
 * currency-api (200+ currencies) for anything the ECB doesn't publish.
 */
import { z } from 'zod'
import type { TripRate } from '../db/schema'

export const FRANKFURTER_BASE = 'https://api.frankfurter.dev/v1'
export const CURRENCY_API_URLS = [
  'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
  'https://latest.currency-api.pages.dev/v1/currencies/usd.json',
]

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const frankfurterSchema = z.object({ date: isoDate, rates: z.record(z.string(), z.number().positive()) })
const currencyApiSchema = z.object({ date: isoDate, usd: z.record(z.string(), z.number()) })

export type FetchedRate = Omit<TripRate, 'source'> & { source: 'ecb' | 'currency_api' }

async function getJson(url: string, fetchImpl: typeof fetch): Promise<unknown | null> {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(8000) })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

/** How many units of `code` one US dollar buys today, and which source said so; null when no source has it. */
export async function fetchUsdRate(code: string, fetchImpl: typeof fetch = fetch): Promise<{ rate: FetchedRate | null; requests: number }> {
  if (!/^[A-Z]{3}$/.test(code) || code === 'USD') return { rate: null, requests: 0 }
  let requests = 1
  const ecb = frankfurterSchema.safeParse(await getJson(`${FRANKFURTER_BASE}/latest?base=USD&symbols=${code}`, fetchImpl))
  const ecbRate = ecb.success ? ecb.data.rates[code] : undefined
  if (ecb.success && ecbRate) return { rate: { perUsd: ecbRate, source: 'ecb', asOf: ecb.data.date }, requests }
  for (const url of CURRENCY_API_URLS) {
    requests++
    const parsed = currencyApiSchema.safeParse(await getJson(url, fetchImpl))
    if (!parsed.success) continue
    const value = parsed.data.usd[code.toLowerCase()]
    return { rate: value && value > 0 ? { perUsd: value, source: 'currency_api', asOf: parsed.data.date } : null, requests }
  }
  return { rate: null, requests }
}
