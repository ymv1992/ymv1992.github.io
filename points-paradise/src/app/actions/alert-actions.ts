'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { announcements, userSettings, type AlertPrefsJson } from '@/lib/db/schema'
import { CABINS, REMINDER_OFFSETS } from '@/lib/domain/constants'
import { ALERT_EVENT_TYPES } from '@/lib/engine/notify'
import { getDeal } from '@/lib/data/deals'
import { markRead } from '@/lib/data/notifications'
import { createWatch, deleteWatch, setWatchActive, watchInputSchema } from '@/lib/data/watchlists'
import { integrationStatus } from '@/lib/server/config'
import { requireUserId } from '@/lib/server/session'
import type { FormState } from '@/components/action-form'

const hhmm = z.preprocess((v) => (v === '' ? null : v), z.string().regex(/^\d{2}:\d{2}$/).nullable())
const optNum = z.preprocess((v) => (v === '' || v == null ? null : v), z.coerce.number().min(0).nullable())
const optDate = z.preprocess((v) => (v === '' ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable())

export async function saveAlertPrefsAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const split = (k: string) =>
    String(fd.get(k) ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  const parsed = z
    .object({
      enabledTypes: z.array(z.enum(ALERT_EVENT_TYPES)),
      minCpp: optNum,
      maxPoints: optNum,
      maxCashUsd: optNum,
      destinations: z.array(z.string().max(60)).max(50),
      cabins: z.array(z.enum(CABINS)),
      hotelCategories: z.array(z.string().max(40)).max(20),
      travelFrom: optDate,
      travelTo: optDate,
      urgentOnly: z.boolean(),
      frequency: z.enum(['instant', 'daily']),
      quietHoursStart: hhmm,
      quietHoursEnd: hhmm,
      reminderOffsets: z.array(z.enum(REMINDER_OFFSETS.map((r) => r.id) as [string, ...string[]])),
    })
    .safeParse({
      enabledTypes: fd.getAll('enabledTypes').map(String),
      minCpp: fd.get('minCpp'),
      maxPoints: fd.get('maxPoints'),
      maxCashUsd: fd.get('maxCashUsd'),
      destinations: split('destinations'),
      cabins: fd.getAll('cabins').map(String),
      hotelCategories: split('hotelCategories'),
      travelFrom: fd.get('travelFrom'),
      travelTo: fd.get('travelTo'),
      urgentOnly: fd.get('urgentOnly') === 'on',
      frequency: fd.get('frequency'),
      quietHoursStart: fd.get('quietHoursStart'),
      quietHoursEnd: fd.get('quietHoursEnd'),
      reminderOffsets: fd.getAll('reminderOffsets').map(String),
    })
  if (!parsed.success) {
    const i = parsed.error.issues[0]
    return { error: i ? `${i.path.join('.')}: ${i.message}` : 'Check the form' }
  }
  await (await getDb())
    .update(userSettings)
    .set({ alertPrefs: parsed.data as AlertPrefsJson, updatedAt: new Date() })
    .where(eq(userSettings.userId, userId))
  revalidatePath('/alerts')
  return { error: null, ok: 'Alert preferences saved.' }
}

export async function markAllReadAction(): Promise<void> {
  const userId = await requireUserId()
  await markRead(await getDb(), userId, 'all')
  revalidatePath('/', 'layout')
}

export async function markReadAction(id: string): Promise<void> {
  const userId = await requireUserId()
  if (!z.string().uuid().safeParse(id).success) return
  await markRead(await getDb(), userId, [id])
  revalidatePath('/', 'layout')
}

export async function createWatchAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const parsed = watchInputSchema.safeParse(Object.fromEntries(fd))
  if (!parsed.success) {
    const i = parsed.error.issues[0]
    return { error: i ? `${i.path.join('.')}: ${i.message}` : 'Check the form' }
  }
  const seats = integrationStatus().seatsAero
  await createWatch(await getDb(), userId, parsed.data, seats)
  revalidatePath('/alerts')
  return {
    error: null,
    ok: parsed.data.kind === 'route' && seats ? 'Watch created — it will be checked on the next scheduled run.' : 'Watch saved. No permitted provider can check it automatically yet, so it is a reminder list for manual checks.',
  }
}

export async function toggleWatchAction(id: string, active: boolean): Promise<void> {
  const userId = await requireUserId()
  if (!z.string().uuid().safeParse(id).success) return
  await setWatchActive(await getDb(), userId, id, active)
  revalidatePath('/alerts')
}

export async function deleteWatchAction(id: string): Promise<void> {
  const userId = await requireUserId()
  if (!z.string().uuid().safeParse(id).success) return
  await deleteWatch(await getDb(), userId, id)
  revalidatePath('/alerts')
}

export async function dismissAnnouncementAction(id: string): Promise<void> {
  await requireUserId()
  if (!z.string().uuid().safeParse(id).success) return
  await (await getDb()).update(announcements).set({ status: 'dismissed' }).where(eq(announcements.id, id))
  revalidatePath('/alerts')
}

/** "Watch for similar": a reminder watch for the same destination (and cabin), auto-checked when possible. */
export async function watchSimilarAction(dealId: string): Promise<void> {
  const userId = await requireUserId()
  if (!z.string().uuid().safeParse(dealId).success) return
  const db = await getDb()
  const deal = await getDeal(db, dealId)
  if (!deal) return
  const isFlight = deal.kind === 'flight' && !!deal.originAirport && !!deal.destination.airport
  await createWatch(
    db,
    userId,
    {
      kind: isFlight ? 'route' : 'similar',
      label: `Similar to ${deal.destination.city} — ${deal.providerName}`,
      origins: isFlight ? [deal.originAirport!] : [],
      destinations: deal.destination.airport ? [deal.destination.airport] : [],
      property: deal.hotel?.property ?? null,
      programId: deal.programId && deal.programId !== 'chase_travel' ? deal.programId : null,
      cabin: deal.flight?.cabin ?? null,
      dateFrom: null,
      dateTo: null,
      maxProgramPoints: deal.programPoints ? Math.round(deal.programPoints * 1.1) : null,
      minCpp: null,
      refreshHours: 48,
      notes: `Created from archived deal ${deal.id}`,
    },
    integrationStatus().seatsAero && isFlight,
  )
  revalidatePath('/alerts')
}
