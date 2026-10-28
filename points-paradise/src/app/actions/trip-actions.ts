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
import {
  addDealToTrip,
  addTripItem,
  arrangeTrip,
  createTrip,
  deleteTrip,
  deleteTripItem,
  setTripItemDone,
  setTripSharing,
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
import { integrationStatus } from '@/lib/server/config'
import { requireUserId } from '@/lib/server/session'
import type { FormState } from '@/components/action-form'

const uuid = z.string().uuid()

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
  const id = await createTrip(await getDb(), userId, parsed.data)
  refresh()
  redirect(`/trips/${id}`)
}

export async function updateTripAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const tripId = uuid.safeParse(fd.get('tripId'))
  if (!tripId.success) return { error: 'Trip not found' }
  const parsed = tripInputSchema.safeParse(Object.fromEntries(fd))
  if (!parsed.success) return { error: firstIssue(parsed.error) }
  if (!(await updateTrip(await getDb(), userId, tripId.data, parsed.data))) return { error: 'Trip not found' }
  refresh(tripId.data)
  return { error: null, ok: 'Saved.' }
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
  const db = await getDb()
  const itemId = fd.get('itemId')
  const r = itemId ? await updateTripItem(db, userId, String(itemId), parsed.data) : await addTripItem(db, userId, tripId.data, parsed.data)
  if (!r.ok) return { error: r.error }
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
