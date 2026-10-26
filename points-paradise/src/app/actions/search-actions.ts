'use server'

import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db/client'
import { awardSearchSchema, runAwardSearch, type AwardSearchResultRow } from '@/lib/data/award-search'
import { config } from '@/lib/server/config'
import { requireUserId } from '@/lib/server/session'

export interface SearchValues {
  origin: string
  destination: string
  cabin: string
  startDate: string
  endDate: string
  includeHomeAirports: boolean
}

export interface SearchState {
  error: string | null
  ok?: string
  results?: AwardSearchResultRow[]
  /** What was submitted, so the form shows it again (React resets forms after an action). */
  values?: SearchValues
  attempt?: number
}

/** Owner-requested award search, within the provider's daily quota. An empty "To" searches anywhere. */
export async function searchAwardsAction(prev: SearchState, fd: FormData): Promise<SearchState> {
  const userId = await requireUserId()
  const values: SearchValues = {
    origin: String(fd.get('origin') ?? '').trim().toUpperCase(),
    destination: String(fd.get('destination') ?? '').trim().toUpperCase(),
    cabin: String(fd.get('cabin') ?? ''),
    startDate: String(fd.get('startDate') ?? ''),
    endDate: String(fd.get('endDate') ?? ''),
    includeHomeAirports: fd.get('includeHomeAirports') === 'on',
  }
  const echo = { values, attempt: (prev.attempt ?? 0) + 1 }
  const key = config.seatsAeroKey()
  if (!key) return { ...echo, error: 'Award search needs a seats.aero Pro API key (SEATS_AERO_API_KEY). Until then, add deals manually.' }
  const parsed = awardSearchSchema.safeParse({
    ...values,
    destination: values.destination === '' || values.destination === 'ANY' ? null : values.destination,
  })
  if (!parsed.success) {
    const i = parsed.error.issues[0]
    return { ...echo, error: i?.path[0] === 'endDate' ? i.message : 'Enter a 3-letter "From" airport, a "To" airport or leave it empty for Anywhere, a cabin and dates.' }
  }
  const out = await runAwardSearch(await getDb(), userId, key, parsed.data)
  if (!out.ok) return { ...echo, error: out.error }
  revalidatePath('/', 'layout')
  const where = out.anywhere ? 'across all destinations' : `to ${parsed.data.destination}`
  const parts = [
    out.total === 0
      ? `No open award seats found ${where} for those dates.`
      : `${out.total} award option${out.total === 1 ? '' : 's'} found ${where}${out.anywhere ? ' (cheapest date per city and month)' : ''}, cheapest first.`,
    out.created ? `${out.created} new in Discover.` : null,
    out.truncated ? 'Some searches hit the result limit — try a shorter date range for more.' : null,
    out.failed ? `${out.failed} of ${out.requests} searches failed; see Settings → Usage.` : null,
    out.total ? 'Values (¢/pt) appear once a cash price is added.' : null,
  ].filter(Boolean)
  return { ...echo, error: null, ok: parts.join(' '), results: out.results }
}
