import { and, desc, eq, inArray, isNull, like, sql } from 'drizzle-orm'
import type { AppDb } from '../db/client'
import { appState, notifications, type AlertPrefsJson } from '../db/schema'
import type { Cabin, ReminderOffsetId } from '../domain/constants'
import { decideAlert, isInQuietHours, notificationKey, type AlertEvent, type AlertEventType, type AlertPreferences } from '../engine/notify'

export interface EmailSender {
  (to: string, subject: string, text: string): Promise<{ ok: boolean; error?: string }>
}

export interface DeliveryConfig {
  prefs: AlertPreferences
  emailEnabled: boolean
  emailTo: string | null
  sendEmail: EmailSender | null
  appUrl: string
}

export function toAlertPreferences(json: AlertPrefsJson | null | undefined, timeZone: string): AlertPreferences {
  const p = json ?? ({} as Partial<AlertPrefsJson>)
  return {
    enabledTypes: (p.enabledTypes ?? []) as AlertEventType[],
    minCpp: p.minCpp ?? null,
    maxPoints: p.maxPoints ?? null,
    maxCashUsd: p.maxCashUsd ?? null,
    destinations: p.destinations ?? [],
    cabins: (p.cabins ?? []) as Cabin[],
    hotelCategories: p.hotelCategories ?? [],
    travelFrom: p.travelFrom ?? null,
    travelTo: p.travelTo ?? null,
    urgentOnly: p.urgentOnly ?? false,
    frequency: p.frequency ?? 'instant',
    quietHoursStart: p.quietHoursStart ?? null,
    quietHoursEnd: p.quietHoursEnd ?? null,
    timeZone,
  }
}

export interface NotifyInput extends AlertEvent {
  title: string
  body: string
  link: string
}

async function deliver(db: AppDb, id: string, n: { title: string; body: string; link: string }, cfg: DeliveryConfig, now: Date) {
  let emailStatus = 'not_configured'
  if (cfg.emailEnabled && cfg.emailTo && cfg.sendEmail) {
    const r = await cfg.sendEmail(cfg.emailTo, `Points & Paradise: ${n.title}`, `${n.body}\n\nOpen: ${cfg.appUrl}${n.link}`)
    emailStatus = r.ok ? 'sent' : `failed: ${r.error ?? 'unknown'}`.slice(0, 300)
  }
  await db.update(notifications).set({ status: 'sent', sentAt: now, emailStatus }).where(eq(notifications.id, id))
}

/**
 * Creates a notification at most once per (user, event key) and delivers it
 * according to the owner's preferences: now, after quiet hours, or in the digest.
 */
export async function notify(db: AppDb, userId: string, input: NotifyInput, cfg: DeliveryConfig, now = new Date()): Promise<{ created: boolean; status: string }> {
  const decision = decideAlert(input, cfg.prefs, now)
  const status = decision.action === 'send' ? 'pending' : decision.action === 'defer' ? 'deferred' : decision.action === 'digest' ? 'digest' : 'suppressed'
  const [row] = await db
    .insert(notifications)
    .values({
      userId,
      eventType: input.type,
      dealId: input.dealId ?? null,
      promotionId: input.promotionId ?? null,
      title: input.title.slice(0, 200),
      body: input.body.slice(0, 2000),
      link: input.link,
      dedupeKey: notificationKey(input),
      status,
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: notifications.id })
  if (!row) return { created: false, status: 'duplicate' }
  if (status === 'pending') await deliver(db, row.id, input, cfg, now)
  return { created: true, status: status === 'pending' ? 'sent' : status }
}

/** Records reminder offsets that were skipped so they are never sent later. */
export async function recordSkippedReminders(db: AppDb, userId: string, dealId: string, offsets: ReminderOffsetId[], now = new Date()) {
  if (offsets.length === 0) return
  await db
    .insert(notifications)
    .values(
      offsets.map((o) => ({
        userId,
        eventType: 'deadline_reminder',
        dealId,
        title: 'Skipped reminder',
        body: `Reminder ${o} was skipped because a later reminder superseded it.`,
        link: `/deals/${dealId}`,
        dedupeKey: notificationKey({ type: 'deadline_reminder', dealId, discriminator: o }),
        status: 'skipped' as const,
        createdAt: now,
      })),
    )
    .onConflictDoNothing()
}

export async function handledReminderOffsets(db: AppDb, userId: string, dealId: string): Promise<Set<ReminderOffsetId>> {
  const prefix = `deadline_reminder|deal:${dealId}|`
  const rows = await db
    .select({ key: notifications.dedupeKey })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), like(notifications.dedupeKey, `${prefix}%`)))
  return new Set(rows.map((r) => r.key.slice(prefix.length) as ReminderOffsetId))
}

/** Sends notifications held back by quiet hours once quiet hours end. */
export async function flushDeferred(db: AppDb, userId: string, cfg: DeliveryConfig, now = new Date()): Promise<number> {
  if (isInQuietHours(now, cfg.prefs.quietHoursStart, cfg.prefs.quietHoursEnd, cfg.prefs.timeZone)) return 0
  const rows = await db.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.status, 'deferred')))
  for (const r of rows) await deliver(db, r.id, r, cfg, now)
  return rows.length
}

/** Sends one digest email per day with everything queued for the digest. */
export async function sendDailyDigest(db: AppDb, userId: string, cfg: DeliveryConfig, now = new Date()): Promise<number> {
  const key = `digest:${userId}`
  const [state] = await db.select().from(appState).where(eq(appState.key, key))
  const last = state ? new Date((state.value as { at: string }).at) : null
  if (last && now.getTime() - last.getTime() < 20 * 3_600_000) return 0
  if (isInQuietHours(now, cfg.prefs.quietHoursStart, cfg.prefs.quietHoursEnd, cfg.prefs.timeZone)) return 0
  const rows = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.status, 'digest')))
    .orderBy(desc(notifications.createdAt))
  if (rows.length === 0) return 0
  let emailStatus = 'not_configured'
  if (cfg.emailEnabled && cfg.emailTo && cfg.sendEmail) {
    const text = rows.map((r) => `• ${r.title}\n  ${r.body}\n  ${cfg.appUrl}${r.link}`).join('\n\n')
    const res = await cfg.sendEmail(cfg.emailTo, `Points & Paradise daily digest (${rows.length})`, text)
    emailStatus = res.ok ? 'sent' : `failed: ${res.error ?? 'unknown'}`.slice(0, 300)
  }
  await db
    .update(notifications)
    .set({ status: 'sent', sentAt: now, emailStatus })
    .where(inArray(notifications.id, rows.map((r) => r.id)))
  await db
    .insert(appState)
    .values({ key, value: { at: now.toISOString() } })
    .onConflictDoUpdate({ target: appState.key, set: { value: { at: now.toISOString() }, updatedAt: now } })
  return rows.length
}

export async function listNotifications(db: AppDb, userId: string, limit = 100) {
  return db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), sql`${notifications.status} not in ('skipped', 'suppressed')`))
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
}

export async function unreadNotifications(db: AppDb, userId: string) {
  return db
    .select({ id: notifications.id, title: notifications.title, body: notifications.body, link: notifications.link, createdAt: notifications.createdAt })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), eq(notifications.status, 'sent')))
    .orderBy(desc(notifications.createdAt))
    .limit(20)
}

export async function markRead(db: AppDb, userId: string, ids: string[] | 'all', now = new Date()) {
  await db
    .update(notifications)
    .set({ readAt: now })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), ids === 'all' ? sql`true` : inArray(notifications.id, ids)))
}
