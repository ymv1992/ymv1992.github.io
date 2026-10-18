'use server'

import { refresh, revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { evaluateOne } from '@/lib/data/evaluation'
import { archiveDeal, deleteDeal, getDeal, markVerified, restoreDeal } from '@/lib/data/deals'
import { recordFeedback, restoreDismissed, undoFeedback } from '@/lib/data/feedback'
import { archiveSaved, saveDeal, setCollections, unsaveDeal, updateSavedDeal } from '@/lib/data/saved'
import { watchDeal } from '@/lib/data/watchlists'
import { integrationStatus } from '@/lib/server/config'
import { requireUserId } from '@/lib/server/session'

const id = z.string().uuid()

export interface ActionResult {
  ok: boolean
  message?: string
  feedbackId?: string
}

function fail(message: string): ActionResult {
  return { ok: false, message }
}

/**
 * Save (bookmark) a deal, recording the original prices for change tracking.
 * `quiet` skips the router refresh so the swipe deck keeps its position.
 */
export async function saveDealAction(dealId: string, collectionIds: string[] = [], quiet = false): Promise<ActionResult> {
  const userId = await requireUserId()
  if (!id.safeParse(dealId).success) return fail('Invalid deal')
  const db = await getDb()
  const one = await evaluateOne(db, userId, dealId)
  if (!one) return fail('Deal not found')
  const e = one.evaluated
  await saveDeal(db, userId, dealId, {
    programPoints: e.deal.programPoints,
    chasePoints: e.valuation.chasePoints,
    mandatoryCashUsd: e.deal.mandatoryCashUsd,
    comparableCashUsd: e.deal.comparableCashUsd,
    cpp: e.valuation.practicalCpp ?? e.valuation.headlineCpp,
  }, collectionIds.filter((c) => id.safeParse(c).success))
  const feedbackId = await recordFeedback(db, userId, dealId, 'save')
  if (!quiet) refresh()
  return { ok: true, feedbackId, message: `Saved ${e.deal.title}` }
}

export async function unsaveDealAction(dealId: string): Promise<ActionResult> {
  const userId = await requireUserId()
  if (!id.safeParse(dealId).success) return fail('Invalid deal')
  await unsaveDeal(await getDb(), userId, dealId)
  refresh()
  return { ok: true, message: 'Removed from Saved' }
}

/** Swipe left. Hidden from Discover but recoverable from History → Passed. */
export async function passDealAction(dealId: string): Promise<ActionResult> {
  const userId = await requireUserId()
  if (!id.safeParse(dealId).success) return fail('Invalid deal')
  const feedbackId = await recordFeedback(await getDb(), userId, dealId, 'pass')
  return { ok: true, feedbackId }
}

/** Undo the last save or pass from the feed. */
export async function undoFeedAction(feedbackId: string): Promise<ActionResult> {
  const userId = await requireUserId()
  if (!id.safeParse(feedbackId).success) return fail('Invalid action')
  const db = await getDb()
  const undone = await undoFeedback(db, userId, feedbackId)
  if (!undone) return fail('Nothing to undo')
  if (undone.type === 'save' && undone.dealId) await unsaveDeal(db, userId, undone.dealId)
  return { ok: true, message: 'Undone' }
}

export async function restoreDismissedAction(dealId: string): Promise<void> {
  const userId = await requireUserId()
  if (!id.safeParse(dealId).success) return
  await restoreDismissed(await getDb(), userId, dealId)
  revalidatePath('/history')
}

export async function rateDealAction(dealId: string, rating: number): Promise<ActionResult> {
  const userId = await requireUserId()
  const r = z.number().int().min(1).max(5).safeParse(rating)
  if (!id.safeParse(dealId).success || !r.success) return fail('Invalid rating')
  await recordFeedback(await getDb(), userId, dealId, 'rating', { rating: r.data })
  refresh()
  return { ok: true, message: 'Thanks — rating recorded' }
}

/** Owner confirms (or denies) current availability on the official site. */
export async function verifyDealAction(dealId: string, available: boolean): Promise<ActionResult> {
  await requireUserId()
  if (!id.safeParse(dealId).success) return fail('Invalid deal')
  try {
    await markVerified(await getDb(), dealId, available)
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Could not update')
  }
  refresh()
  return { ok: true, message: available ? 'Marked as verified just now' : 'Marked unavailable and moved to History' }
}

export async function watchDealAction(dealId: string): Promise<ActionResult> {
  const userId = await requireUserId()
  if (!id.safeParse(dealId).success) return fail('Invalid deal')
  const db = await getDb()
  const deal = await getDeal(db, dealId)
  if (!deal) return fail('Deal not found')
  if (deal.sourceKind === 'demo') return fail('Demo deals are fictional and cannot be watched')
  const res = await watchDeal(db, userId, deal, integrationStatus().seatsAero)
  refresh()
  return {
    ok: true,
    message: res.autoCheck
      ? 'Watching — permitted automatic re-checks are scheduled.'
      : 'Watching — no permitted data source can re-check this automatically, so you will get reminders to verify it manually.',
  }
}

export async function archiveDealAction(dealId: string): Promise<ActionResult> {
  await requireUserId()
  if (!id.safeParse(dealId).success) return fail('Invalid deal')
  await archiveDeal(await getDb(), dealId, 'archived_by_owner')
  refresh()
  return { ok: true, message: 'Moved to History' }
}

export async function restoreDealAction(dealId: string): Promise<ActionResult> {
  await requireUserId()
  if (!id.safeParse(dealId).success) return fail('Invalid deal')
  await restoreDeal(await getDb(), dealId)
  refresh()
  return { ok: true, message: 'Restored' }
}

export async function deleteDealAction(dealId: string): Promise<ActionResult> {
  await requireUserId()
  if (!id.safeParse(dealId).success) return fail('Invalid deal')
  await deleteDeal(await getDb(), dealId)
  revalidatePath('/', 'layout')
  return { ok: true, message: 'Deleted' }
}

export async function setSavedCollectionsAction(savedDealId: string, collectionIds: string[]): Promise<ActionResult> {
  const userId = await requireUserId()
  if (!id.safeParse(savedDealId).success) return fail('Invalid saved deal')
  await setCollections(await getDb(), userId, savedDealId, collectionIds.filter((c) => id.safeParse(c).success))
  refresh()
  return { ok: true, message: 'Collections updated' }
}

const savedPatch = z.object({
  notes: z.string().max(2000).nullable().optional(),
  alertPriceDrop: z.boolean().optional(),
  alertAvailability: z.boolean().optional(),
  alertDeadline: z.boolean().optional(),
  booked: z.boolean().optional(),
})

export async function updateSavedAction(savedDealId: string, patch: z.infer<typeof savedPatch>): Promise<ActionResult> {
  const userId = await requireUserId()
  const p = savedPatch.safeParse(patch)
  if (!id.safeParse(savedDealId).success || !p.success) return fail('Invalid update')
  const { booked, ...rest } = p.data
  await updateSavedDeal(await getDb(), userId, savedDealId, { ...rest, ...(booked === undefined ? {} : { bookedAt: booked ? new Date() : null }) })
  refresh()
  return { ok: true, message: 'Saved' }
}

export async function archiveSavedAction(savedDealId: string, archived: boolean): Promise<ActionResult> {
  const userId = await requireUserId()
  if (!id.safeParse(savedDealId).success) return fail('Invalid saved deal')
  await archiveSaved(await getDb(), userId, savedDealId, archived)
  refresh()
  return { ok: true, message: archived ? 'Archived' : 'Restored' }
}
