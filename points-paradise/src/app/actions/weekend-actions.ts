'use server'

import { revalidatePath } from 'next/cache'
import { getDb } from '@/lib/db/client'
import { findWeekendGetaways, weekendSchema, type WeekendOutcome } from '@/lib/data/weekend-getaways'
import { config } from '@/lib/server/config'
import { requireUserId } from '@/lib/server/session'

export interface WeekendState {
  error: string | null
  outcome?: Extract<WeekendOutcome, { ok: true }>
  values?: { origin: string; includeHomeAirports: boolean; weeks: string; shape: string; cabin: string; seats: string; maxMiles: string }
  attempt?: number
}

/** Weekend award trips from the home airports over the coming weekends (about 20 seats.aero lookups). */
export async function findWeekendsAction(prev: WeekendState, fd: FormData): Promise<WeekendState> {
  const userId = await requireUserId()
  const values = {
    origin: String(fd.get('origin') ?? '').trim().toUpperCase(),
    includeHomeAirports: fd.get('includeHomeAirports') === 'on',
    weeks: String(fd.get('weeks') ?? '8'),
    shape: String(fd.get('shape') ?? 'long'),
    cabin: String(fd.get('cabin') ?? 'economy'),
    seats: String(fd.get('seats') ?? '1'),
    maxMiles: String(fd.get('maxMiles') ?? '2500'),
  }
  const echo = { values, attempt: (prev.attempt ?? 0) + 1 }
  const key = config.seatsAeroKey()
  if (!key) return { ...echo, error: 'Weekend search needs the seats.aero Pro API key (SEATS_AERO_API_KEY).' }
  const parsed = weekendSchema.safeParse({ ...values, maxMiles: values.maxMiles === 'any' ? null : values.maxMiles })
  if (!parsed.success) return { ...echo, error: 'Enter a 3-letter airport code to leave from.' }
  const out = await findWeekendGetaways(await getDb(), userId, key, parsed.data)
  if (!out.ok) return { ...echo, error: out.error }
  revalidatePath('/', 'layout')
  return { ...echo, error: null, outcome: out }
}
