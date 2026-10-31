'use server'

import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db/client'
import { awardSearchSchema, runAwardSearch, type AwardSearchOutcome } from '@/lib/data/award-search'
import { airlineName, AWARD_PROGRAMS } from '@/lib/domain/airlines'
import { z } from 'zod'
import { loadAccount } from '@/lib/data/account'
import { lookupCashPrice } from '@/lib/data/cash-prices'
import { getDeal } from '@/lib/data/deals'
import { evaluateMany } from '@/lib/data/evaluation'
import { hotelSearchSchema, runHotelSearch, type HotelSearchResultRow } from '@/lib/data/hotel-search'
import { config } from '@/lib/server/config'
import { requireUserId } from '@/lib/server/session'

export interface SearchValues {
  origin: string
  destination: string
  /** A cabin, or 'all' to compare every cabin. */
  cabin: string
  startDate: string
  endDate: string
  tripType: 'one_way' | 'round_trip'
  returnStart: string
  returnEnd: string
  seats: string
  includeHomeAirports: boolean
  /** Airline code, or '' for any. */
  airline: string
  /** Program id, or '' for any. */
  program: string
}

export interface SearchState {
  error: string | null
  ok?: string
  outcome?: Extract<AwardSearchOutcome, { ok: true }>
  /** What was submitted, so the form shows it again (React resets forms after an action). */
  values?: SearchValues
  attempt?: number
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : word.endsWith('h') ? 'es' : 's'}`

/** Owner-requested award search, within the provider's daily quota. An empty "To" searches anywhere. */
export async function searchAwardsAction(prev: SearchState, fd: FormData): Promise<SearchState> {
  const userId = await requireUserId()
  const values: SearchValues = {
    origin: String(fd.get('origin') ?? '').trim().toUpperCase(),
    destination: String(fd.get('destination') ?? '').trim().toUpperCase(),
    cabin: String(fd.get('cabin') ?? ''),
    startDate: String(fd.get('startDate') ?? ''),
    endDate: String(fd.get('endDate') ?? ''),
    tripType: fd.get('tripType') === 'round_trip' ? 'round_trip' : 'one_way',
    returnStart: String(fd.get('returnStart') ?? ''),
    returnEnd: String(fd.get('returnEnd') ?? ''),
    seats: String(fd.get('seats') ?? '1'),
    includeHomeAirports: fd.get('includeHomeAirports') === 'on',
    airline: String(fd.get('airline') ?? '').trim().toUpperCase(),
    program: String(fd.get('program') ?? '').trim(),
  }
  const echo = { values, attempt: (prev.attempt ?? 0) + 1 }
  const key = config.seatsAeroKey()
  if (!key) return { ...echo, error: 'Award search needs a seats.aero Pro API key (SEATS_AERO_API_KEY). Until then, add deals manually.' }
  const roundTrip = values.tripType === 'round_trip'
  const parsed = awardSearchSchema.safeParse({
    ...values,
    destination: values.destination === '' || values.destination === 'ANY' ? null : values.destination,
    returnStart: roundTrip ? values.returnStart || null : null,
    returnEnd: roundTrip ? values.returnEnd || null : null,
    seats: Number(values.seats) || 1,
    airline: values.airline || null,
    program: values.program || null,
  })
  if (!parsed.success) {
    const i = parsed.error.issues[0]
    const field = String(i?.path[0] ?? '')
    return { ...echo, error: ['endDate', 'destination', 'returnStart', 'returnEnd'].includes(field) ? i!.message : 'Enter a 3-letter "From" airport, a "To" airport or leave it empty for Anywhere, a cabin and dates.' }
  }
  const s = parsed.data
  const out = await runAwardSearch(await getDb(), userId, key, s)
  if (!out.ok) return { ...echo, error: out.error }
  revalidatePath('/', 'layout')
  const program = AWARD_PROGRAMS.find((p) => p.id === s.program)
  const filters = [s.airline ? `on ${airlineName(s.airline)}` : null, program ? `with ${program.label}` : null].filter(Boolean).join(' ')
  const where = `${out.anywhere ? 'across all destinations' : `to ${s.destination}`}${filters ? ` ${filters}` : ''}`
  const found = out.allCabins ? `${out.anywhere ? `${out.total} city-and-month combination${out.total === 1 ? '' : 's'}` : plural(out.total, 'date')} with open seats` : plural(out.total, 'award option')
  const backFound = out.returnLeg ? (out.allCabins ? plural(out.returnLeg.total, 'date') : plural(out.returnLeg.total, 'option')) : null
  const nothing = out.total === 0 && (!out.returnLeg || out.returnLeg.total === 0)
  const parts = [
    nothing
      ? `No open award seats found ${where} for those dates.${filters ? ' Try "Any airline" or "Any program" to see everything.' : ''}`
      : roundTrip
        ? `Going ${where}: ${found}. Coming back: ${backFound}.`
        : `${found} ${where}${out.anywhere ? ' (cheapest date per city and month)' : ''}, cheapest first.`,
    roundTrip && !nothing && out.roundTrips.length === 0 ? 'No cabin has seats both ways with the return on or after the way out — try wider dates.' : null,
    out.hiddenForSeats ? `${plural(out.hiddenForSeats, 'option')} with fewer than ${s.seats} seats left ${out.hiddenForSeats === 1 ? 'was' : 'were'} left out.` : null,
    out.created ? `${out.created} new in Discover.` : null,
    out.truncated ? 'Some searches hit the result limit — try a shorter date range for more.' : null,
    out.failed ? `${plural(out.failed, 'search')} failed; see Settings → Usage.` : null,
  ].filter(Boolean)
  return { ...echo, error: null, ok: parts.join(' '), outcome: out }
}

export interface HotelSearchState {
  error: string | null
  ok?: string
  results?: HotelSearchResultRow[]
  values?: { place: string; startDate: string; endDate: string; nights: string; programs: string[] }
  attempt?: number
}

/** Owner-requested hotel award search through rooms.aero (same key as seats.aero). */
export async function searchHotelsAction(prev: HotelSearchState, fd: FormData): Promise<HotelSearchState> {
  const userId = await requireUserId()
  const values = {
    place: String(fd.get('place') ?? '').trim(),
    startDate: String(fd.get('startDate') ?? ''),
    endDate: String(fd.get('endDate') ?? ''),
    nights: String(fd.get('nights') ?? '2'),
    programs: fd.getAll('programs').map(String),
  }
  const echo = { values, attempt: (prev.attempt ?? 0) + 1 }
  const key = config.seatsAeroKey()
  if (!key) return { ...echo, error: 'Hotel search needs the seats.aero Pro API key (SEATS_AERO_API_KEY); rooms.aero uses the same key.' }
  const parsed = hotelSearchSchema.safeParse(values)
  if (!parsed.success) return { ...echo, error: parsed.error.issues[0]?.message ?? 'Check the search' }
  const out = await runHotelSearch(await getDb(), userId, key, parsed.data)
  if (!out.ok) return { ...echo, error: out.error }
  revalidatePath('/', 'layout')
  if (!out.placeFound) return { ...echo, error: `rooms.aero couldn't find "${parsed.data.place}". Try a city or region name, such as "Maui, Hawaii".` }
  const msg =
    out.total === 0
      ? `No award nights found near ${parsed.data.place} for those dates at the chosen programs.`
      : `${out.total} award stay${out.total === 1 ? '' : 's'} near ${parsed.data.place}, best value first.${out.created ? ` ${out.created} new in Discover.` : ''}`
  return { ...echo, error: null, ok: msg, results: out.results }
}

export interface PriceState {
  ok: boolean
  message: string
  cashUsd?: number | null
  cpp?: number | null
}

/** Looks up the comparable cash price for one deal on demand (one SerpApi search). */
export async function priceDealAction(dealId: string): Promise<PriceState> {
  const userId = await requireUserId()
  if (!z.string().uuid().safeParse(dealId).success) return { ok: false, message: 'Invalid deal' }
  const key = config.serpApiKey()
  if (!key) return { ok: false, message: 'Cash prices need a SerpApi key (SERPAPI_API_KEY). See Settings → Data sources.' }
  const db = await getDb()
  const deal = await getDeal(db, dealId)
  if (!deal) return { ok: false, message: 'Deal not found' }
  if (deal.sourceKind === 'demo' || deal.sourceKind === 'manual') return { ok: false, message: 'Cash lookups are only for deals found through seats.aero or rooms.aero.' }
  const { settings } = await loadAccount(db, userId)
  const r = await lookupCashPrice(db, deal, { apiKey: key, now: new Date(), fetch, monthlyCapUsd: settings.monthlyApiBudgetUsd, jobType: 'cash_lookup' })
  if (r.status !== 'priced') return { ok: false, message: r.reason }
  const value = (await evaluateMany(db, userId, [dealId])).get(dealId)
  revalidatePath('/', 'layout')
  const cpp = value?.valuation.calculable ? (value.valuation.practicalCpp ?? value.valuation.headlineCpp) : null
  return { ok: true, message: cpp != null ? `$${Math.round(r.cashUsd).toLocaleString('en-US')} cash · ${cpp.toFixed(2)}¢/pt` : `$${Math.round(r.cashUsd).toLocaleString('en-US')} cash`, cashUsd: r.cashUsd, cpp }
}
