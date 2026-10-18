import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { AppDb } from '../db/client'
import { deals, feedback, travelProfiles, userSettings } from '../db/schema'
import { learnFromFeedback, type FeedbackSignal } from '../engine/personalization'

export const FEEDBACK_TYPES = ['save', 'pass', 'rating', 'booked', 'not_interested'] as const
export type FeedbackType = (typeof FEEDBACK_TYPES)[number]

async function activeProfileId(db: AppDb, userId: string): Promise<string | null> {
  const [s] = await db.select({ id: userSettings.activeProfileId }).from(userSettings).where(eq(userSettings.userId, userId))
  return s?.id ?? null
}

async function learn(db: AppDb, userId: string, tags: string[], signal: FeedbackSignal, rating?: number) {
  const profileId = await activeProfileId(db, userId)
  if (!profileId || tags.length === 0) return
  const [p] = await db.select({ w: travelProfiles.learnedWeights }).from(travelProfiles).where(eq(travelProfiles.id, profileId))
  if (!p) return
  const next = learnFromFeedback(p.w, tags, signal, rating) as Record<string, number>
  await db.update(travelProfiles).set({ learnedWeights: next, updatedAt: new Date() }).where(eq(travelProfiles.id, profileId))
}

/** Records feedback and nudges learned preferences. Returns the feedback id for undo. */
export async function recordFeedback(
  db: AppDb,
  userId: string,
  dealId: string,
  type: FeedbackType,
  opts: { rating?: number; notes?: string } = {},
): Promise<string> {
  const [deal] = await db.select({ tags: deals.tags }).from(deals).where(eq(deals.id, dealId))
  if (!deal) throw new Error('Deal not found')
  const [row] = await db
    .insert(feedback)
    .values({ userId, dealId, feedbackType: type, rating: opts.rating ?? null, notes: opts.notes ?? null, tags: deal.tags })
    .returning({ id: feedback.id })
  const signal: FeedbackSignal | null = type === 'save' ? 'save' : type === 'pass' || type === 'not_interested' ? 'pass' : type === 'booked' ? 'booked' : type === 'rating' ? 'rating' : null
  if (signal) await learn(db, userId, deal.tags, signal, opts.rating)
  return row!.id
}

/** Reverses a feedback event (e.g. Undo after a swipe) including its learning effect. */
export async function undoFeedback(db: AppDb, userId: string, feedbackId: string, now = new Date()): Promise<{ dealId: string | null; type: string } | null> {
  const [row] = await db
    .select()
    .from(feedback)
    .where(and(eq(feedback.id, feedbackId), eq(feedback.userId, userId), isNull(feedback.undoneAt)))
  if (!row) return null
  await db.update(feedback).set({ undoneAt: now }).where(eq(feedback.id, feedbackId))
  if (row.feedbackType === 'save') await learn(db, userId, row.tags, 'undo_save')
  if (row.feedbackType === 'pass' || row.feedbackType === 'not_interested') await learn(db, userId, row.tags, 'undo_pass')
  return { dealId: row.dealId, type: row.feedbackType }
}

/** Deals the owner passed on and has not restored. They are hidden from Discover but recoverable. */
export async function dismissedDealIds(db: AppDb, userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ dealId: feedback.dealId })
    .from(feedback)
    .where(and(eq(feedback.userId, userId), inArray(feedback.feedbackType, ['pass', 'not_interested']), isNull(feedback.undoneAt)))
  return new Set(rows.map((r) => r.dealId).filter((x): x is string => !!x))
}

export async function listDismissed(db: AppDb, userId: string) {
  return db
    .select({ id: feedback.id, dealId: feedback.dealId, createdAt: feedback.createdAt })
    .from(feedback)
    .where(and(eq(feedback.userId, userId), inArray(feedback.feedbackType, ['pass', 'not_interested']), isNull(feedback.undoneAt)))
    .orderBy(desc(feedback.createdAt))
}

/** Restores every pass for a deal so it appears in Discover again. */
export async function restoreDismissed(db: AppDb, userId: string, dealId: string, now = new Date()): Promise<void> {
  const rows = await db
    .select({ id: feedback.id })
    .from(feedback)
    .where(and(eq(feedback.userId, userId), eq(feedback.dealId, dealId), inArray(feedback.feedbackType, ['pass', 'not_interested']), isNull(feedback.undoneAt)))
  for (const r of rows) await undoFeedback(db, userId, r.id, now)
}

/** Clears learned weights and feedback history for the active profile. */
export async function resetPersonalization(db: AppDb, userId: string): Promise<void> {
  await db.update(travelProfiles).set({ learnedWeights: {}, updatedAt: new Date() }).where(eq(travelProfiles.userId, userId))
  await db.delete(feedback).where(eq(feedback.userId, userId))
}
