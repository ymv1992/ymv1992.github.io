'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { addTikTokIdea, dismissTikTok, likeGuideIdea, saveTikTok, skipGuideIdea, unskipGuideIdeas } from '@/lib/data/ideas'
import { requireUserId } from '@/lib/server/session'
import type { FormState } from '@/components/action-form'

const uuid = z.string().uuid()
const deps = () => ({ fetch, now: new Date() })

function refresh(tripId: string) {
  revalidatePath('/ideas')
  revalidatePath(`/trips/${tripId}`)
}

export interface TikTokFormState extends FormState {
  attempt?: number
}

/** Saves a pasted (or shared) TikTok link to a trip, to confirm its place before adding it. */
export async function saveTikTokAction(prev: TikTokFormState, fd: FormData): Promise<TikTokFormState> {
  const userId = await requireUserId()
  const tripId = uuid.safeParse(fd.get('tripId'))
  const attempt = (prev.attempt ?? 0) + 1
  if (!tripId.success) return { error: 'Choose a trip first', attempt }
  const r = await saveTikTok(await getDb(), userId, tripId.data, String(fd.get('link') ?? ''), deps())
  if (!r.ok) return { error: r.error, attempt }
  refresh(tripId.data)
  return { error: null, ok: r.found ? `Saved. It looks like ${r.title} — check the place below and add it.` : 'Saved. The caption doesn’t say where it is; type the place below and add it.', attempt }
}

export async function addTikTokAction(tripId: string, suggestionId: string, place: string): Promise<{ ok: boolean; message: string }> {
  const userId = await requireUserId()
  if (!uuid.safeParse(tripId).success || !uuid.safeParse(suggestionId).success) return { ok: false, message: 'Not found' }
  const r = await addTikTokIdea(await getDb(), userId, suggestionId, place, deps())
  if (!r.ok) return { ok: false, message: r.error }
  refresh(tripId)
  return { ok: true, message: 'Added to the trip’s Ideas.' }
}

export async function dismissTikTokAction(tripId: string, suggestionId: string): Promise<void> {
  const userId = await requireUserId()
  if (!uuid.safeParse(tripId).success || !uuid.safeParse(suggestionId).success) return
  await dismissTikTok(await getDb(), userId, suggestionId)
  refresh(tripId)
}

export async function likeIdeaAction(tripId: string, city: string, countryCode: string | null, key: string): Promise<{ ok: boolean; message: string }> {
  const userId = await requireUserId()
  if (!uuid.safeParse(tripId).success) return { ok: false, message: 'Trip not found' }
  const r = await likeGuideIdea(await getDb(), userId, tripId, city.slice(0, 120), key.slice(0, 300), { ...deps(), countryCode: countryCode?.slice(0, 2) ?? null })
  if (!r.ok) return { ok: false, message: r.error }
  // No revalidation: the trip page is always rendered fresh, and refreshing this page would reset the deck mid-swipe.
  return { ok: true, message: `Added ${r.title} to Ideas.` }
}

export async function skipIdeaAction(tripId: string, city: string, key: string): Promise<void> {
  const userId = await requireUserId()
  if (!uuid.safeParse(tripId).success) return
  await skipGuideIdea(await getDb(), userId, tripId, city.slice(0, 120), key.slice(0, 300), deps())
}

export async function unskipIdeasAction(tripId: string): Promise<void> {
  const userId = await requireUserId()
  if (!uuid.safeParse(tripId).success) return
  await unskipGuideIdeas(await getDb(), userId, tripId)
  revalidatePath('/ideas')
}
