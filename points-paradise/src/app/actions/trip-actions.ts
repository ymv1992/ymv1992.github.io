'use server'

import { inArray } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { tripItems } from '@/lib/db/schema'
import { loadAccount } from '@/lib/data/account'
import { getDeal } from '@/lib/data/deals'
import { evaluateMany } from '@/lib/data/evaluation'
import { enrichTripItem, itemsNeedingMedia } from '@/lib/data/place-media'
import { lookUpTripFlight } from '@/lib/data/trip-flights'
import { ensureTripRates, refreshTripRate, setTripRate } from '@/lib/data/trip-rates'
import {
  addDealToTrip,
  addTripItem,
  arrangeTrip,
  cleanBooking,
  createTrip,
  deleteTrip,
  deleteTripItem,
  setTripItemDone,
  setTripSharing,
  tripBookingInputSchema,
  tripInputSchema,
  tripItemInputSchema,
  tripLayoutSchema,
  unwatchTrip,
  updateTrip,
  updateTripItem,
  watchTrip,
  type TripLayout,
} from '@/lib/data/trips'
import { CABINS } from '@/lib/domain/constants'
import { currencyName, isKnownCurrency } from '@/lib/trips/money'
import { config, integrationStatus } from '@/lib/server/config'
import { requireUserId } from '@/lib/server/session'
import type { FormState } from '@/components/action-form'

const uuid = z.string().uuid()
/** Most items still unlooked-up that one "Find maps & photos" press handles (OpenStreetMap allows one search a second). */
const MEDIA_BATCH = 8

const placeDeps = () => ({ fetch, now: new Date() })
const rateDeps = placeDeps

function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? 'Please check the form'
}

function refresh(tripId?: string) {
  revalidatePath('/trips')
  if (tripId) revalidatePath(`/trips/${tripId}`)
}

export async function createTripAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const parsed = tripInputSchema.safeParse(Object.fromEntries(fd))
  if (!parsed.success) return { error: firstIssue(parsed.error) }
  const db = await getDb()
  const id = await createTrip(db, userId, parsed.data)
  if (parsed.data.currency) await ensureTripRates(db, userId, id, [parsed.data.currency], rateDeps())
  refresh()
  redirect(`/trips/${id}`)
}

export async function updateTripAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const tripId = uuid.safeParse(fd.get('tripId'))
  if (!tripId.success) return { error: 'Trip not found' }
  const parsed = tripInputSchema.safeParse(Object.fromEntries(fd))
  if (!parsed.success) return { error: firstIssue(parsed.error) }
  const db = await getDb()
  if (!(await updateTrip(db, userId, tripId.data, parsed.data))) return { error: 'Trip not found' }
  const missing = parsed.data.currency ? await ensureTripRates(db, userId, tripId.data, [parsed.data.currency], rateDeps()) : []
  refresh(tripId.data)
  return { error: null, ok: missing.length ? `Saved. No free rate was found for ${missing.join(', ')}; type your own under Exchange rates.` : 'Saved.' }
}

export async function deleteTripAction(tripId: string): Promise<void> {
  const userId = await requireUserId()
  if (!uuid.safeParse(tripId).success) return
  await deleteTrip(await getDb(), userId, tripId)
  revalidatePath('/alerts')
  refresh()
  redirect('/trips')
}

export interface TripItemFormState {
  error: string | null
  ok?: string
}

/** Adds a new item, or saves an existing one when the form carries its itemId. */
export async function saveTripItemAction(_prev: TripItemFormState, fd: FormData): Promise<TripItemFormState> {
  const userId = await requireUserId()
  const tripId = uuid.safeParse(fd.get('tripId'))
  if (!tripId.success) return { error: 'Trip not found' }
  const parsed = tripItemInputSchema.safeParse(Object.fromEntries(fd))
  if (!parsed.success) return { error: firstIssue(parsed.error) }
  // Booking details arrive as b_… fields; only the ones that fit the kind of item are kept.
  const bookingFields = Object.fromEntries([...fd.entries()].filter(([k]) => k.startsWith('b_')).map(([k, v]) => [k.slice(2), v]))
  const booking = tripBookingInputSchema.safeParse(bookingFields)
  if (!booking.success) return { error: firstIssue(booking.error) }
  const input = { ...parsed.data, booking: cleanBooking(parsed.data.kind, booking.data) }
  const db = await getDb()
  const itemId = fd.get('itemId')
  const r = itemId ? await updateTripItem(db, userId, String(itemId), input) : await addTripItem(db, userId, tripId.data, input)
  if (!r.ok) return { error: r.error }
  // New items are looked up unless they are plain notes; edits only when where-it-is changed.
  const lookUp = itemId ? 'placeChanged' in r && r.placeChanged : parsed.data.kind !== 'note' || parsed.data.place != null || parsed.data.url != null
  if (lookUp) await enrichTripItem(db, userId, r.id, placeDeps())
  if (parsed.data.costAmount != null && parsed.data.costCurrency !== 'USD') await ensureTripRates(db, userId, tripId.data, [parsed.data.costCurrency], rateDeps())
  refresh(tripId.data)
  return { error: null, ok: itemId ? 'Saved.' : 'Added.' }
}

export async function deleteTripItemAction(tripId: string, itemId: string): Promise<void> {
  const userId = await requireUserId()
  if (!uuid.safeParse(itemId).success || !uuid.safeParse(tripId).success) return
  await deleteTripItem(await getDb(), userId, itemId)
  refresh(tripId)
}

export async function setTripItemDoneAction(tripId: string, itemId: string, done: boolean): Promise<void> {
  const userId = await requireUserId()
  if (!uuid.safeParse(itemId).success || !uuid.safeParse(tripId).success) return
  await setTripItemDone(await getDb(), userId, itemId, done === true)
  refresh(tripId)
}

export async function arrangeTripAction(tripId: string, layout: TripLayout): Promise<{ ok: boolean; error?: string }> {
  const userId = await requireUserId()
  if (!uuid.safeParse(tripId).success) return { ok: false, error: 'Trip not found' }
  const parsed = tripLayoutSchema.safeParse(layout)
  if (!parsed.success) return { ok: false, error: 'Could not save the new order' }
  const r = await arrangeTrip(await getDb(), userId, tripId, parsed.data)
  if (r.ok) refresh(tripId)
  return r
}

export async function addDealToTripAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const tripId = uuid.safeParse(fd.get('tripId'))
  const dealId = uuid.safeParse(fd.get('dealId'))
  if (!tripId.success) return { error: 'Trip not found' }
  if (!dealId.success) return { error: 'Choose a deal' }
  const db = await getDb()
  const deal = await getDeal(db, dealId.data)
  if (!deal || deal.sourceKind === 'demo') return { error: 'That deal cannot be added' }
  const existing = await db.select({ id: tripItems.id, tripId: tripItems.tripId }).from(tripItems).where(inArray(tripItems.dealId, [deal.id]))
  if (existing.some((e) => e.tripId === tripId.data)) return { error: 'Already in this trip' }
  const chasePoints = (await evaluateMany(db, userId, [deal.id])).get(deal.id)?.valuation.chasePoints ?? null
  const r = await addDealToTrip(db, userId, tripId.data, deal, chasePoints)
  if (!r.ok) return { error: r.error }
  await enrichTripItem(db, userId, r.id, placeDeps())
  refresh(tripId.data)
  return { error: null, ok: 'Added to the trip.' }
}

export async function shareTripAction(tripId: string, on: boolean): Promise<{ token: string | null }> {
  const userId = await requireUserId()
  if (!uuid.safeParse(tripId).success) return { token: null }
  const token = await setTripSharing(await getDb(), userId, tripId, on === true)
  refresh(tripId)
  return { token }
}

export async function watchTripAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const tripId = uuid.safeParse(fd.get('tripId'))
  if (!tripId.success) return { error: 'Trip not found' }
  const cabin = z.enum(CABINS).safeParse(fd.get('cabin'))
  if (!cabin.success) return { error: 'Choose a cabin' }
  const db = await getDb()
  const typed = String(fd.get('origins') ?? '')
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter((c) => /^[A-Z]{3}$/.test(c))
  const origins = typed.length ? typed : (await loadAccount(db, userId)).profile.homeAirports
  const seats = integrationStatus().seatsAero
  const r = await watchTrip(db, userId, tripId.data, { origins, cabin: cabin.data, seatsAeroConfigured: seats })
  if (!r.ok) return { error: r.error }
  revalidatePath('/alerts')
  refresh(tripId.data)
  return { error: null, ok: seats ? 'Watching. New award space shows up in Alerts.' : 'Saved. Add your seats.aero key so it can be checked automatically.' }
}

export async function unwatchTripAction(tripId: string): Promise<void> {
  const userId = await requireUserId()
  if (!uuid.safeParse(tripId).success) return
  await unwatchTrip(await getDb(), userId, tripId)
  revalidatePath('/alerts')
  refresh(tripId)
}

/** Looks up maps and photos for items that don't have them yet, a few at a time. */
export async function findTripMediaAction(tripId: string): Promise<{ checked: number; maps: number; photos: number; remaining: number }> {
  const userId = await requireUserId()
  if (!uuid.safeParse(tripId).success) return { checked: 0, maps: 0, photos: 0, remaining: 0 }
  const db = await getDb()
  const todo = await itemsNeedingMedia(db, userId, tripId)
  let maps = 0
  let photos = 0
  for (const { id } of todo.slice(0, MEDIA_BATCH)) {
    const r = await enrichTripItem(db, userId, id, placeDeps())
    if (r.map) maps++
    if (r.photo) photos++
  }
  refresh(tripId)
  return { checked: Math.min(todo.length, MEDIA_BATCH), maps, photos, remaining: Math.max(0, todo.length - MEDIA_BATCH) }
}

/** Saves the owner's own rate for a currency ("1 US dollar = … units"). */
export async function setTripRateAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const tripId = uuid.safeParse(fd.get('tripId'))
  const code = String(fd.get('currency') ?? '')
  const perUsd = Number(String(fd.get('perUsd') ?? '').replace(/,/g, ''))
  if (!tripId.success || !isKnownCurrency(code)) return { error: 'Unknown currency' }
  if (!(perUsd > 0)) return { error: 'Enter how much 1 US dollar is worth, like 152.5' }
  if (!(await setTripRate(await getDb(), userId, tripId.data, code, perUsd))) return { error: 'Could not save the rate' }
  refresh(tripId.data)
  return { error: null, ok: 'Saved your rate.' }
}

/** Replaces a currency's locked rate with today's. */
export async function refreshTripRateAction(tripId: string, code: string): Promise<{ ok: boolean; message: string }> {
  const userId = await requireUserId()
  if (!uuid.safeParse(tripId).success || !isKnownCurrency(code)) return { ok: false, message: 'Unknown currency' }
  const rate = await refreshTripRate(await getDb(), userId, tripId, code, rateDeps())
  if (!rate) return { ok: false, message: `No free source has a ${currencyName(code)} rate right now. You can type your own.` }
  refresh(tripId)
  return { ok: true, message: `Updated to today's rate: 1 USD = ${rate.perUsd.toLocaleString('en-US', { maximumFractionDigits: 4 })} ${code}.` }
}

/** Fills a flight's times and aircraft from Google Flights (one SerpApi search). */
export async function lookUpTripFlightAction(tripId: string, itemId: string): Promise<{ ok: boolean; message: string }> {
  const userId = await requireUserId()
  if (!uuid.safeParse(tripId).success || !uuid.safeParse(itemId).success) return { ok: false, message: 'Not found' }
  const apiKey = config.serpApiKey()
  if (!apiKey) return { ok: false, message: 'Looking up flights needs the SerpApi key (SERPAPI_API_KEY). See Settings → Data sources.' }
  const db = await getDb()
  const { settings } = await loadAccount(db, userId)
  const r = await lookUpTripFlight(db, userId, itemId, { apiKey, now: new Date(), fetch, monthlyCapUsd: settings.monthlyApiBudgetUsd })
  if (!r.ok) return { ok: false, message: r.error }
  refresh(tripId)
  const s = r.schedule
  return { ok: true, message: `Found it: departs ${s.departTime}, arrives ${s.arriveTime}${s.arriveDayOffset ? ' (next day)' : ''}${s.aircraft ? `, ${s.aircraft}` : ''}.` }
}
