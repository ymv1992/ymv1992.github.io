import { REMINDER_OFFSETS, type DeadlineType, type ReminderOffsetId } from '../domain/constants'
import type { Deal } from '../domain/types'

export interface DeadlineView {
  type: DeadlineType
  at: Date | null
  timezone: string | null
  source: string | null
  /** Only confirmed deadlines get a countdown. */
  countdownMs: number | null
  confidence: 'high' | 'medium' | 'low' | 'none'
  lastCheckedAt: Date | null
  headline: string
  detail: string
}

export function formatCountdown(ms: number): string {
  if (ms <= 0) return 'Ended'
  const mins = Math.floor(ms / 60_000)
  const days = Math.floor(mins / 1440)
  const hours = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${m}m`
  return `${m}m`
}

export function formatInZone(date: Date, timeZone: string | null): string {
  const tz = timeZone ?? 'UTC'
  try {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: tz,
      timeZoneName: 'short',
    }).format(date)
  } catch {
    return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
  }
}

/**
 * Describes a deal's deadline without inventing one. Observed availability and
 * estimated urgency never get a date or countdown.
 */
export function describeDeadline(
  deal: Pick<Deal, 'deadline' | 'lastVerifiedAt' | 'availability'>,
  now: Date,
  displayTimeZone: string | null = null,
): DeadlineView {
  const d = deal.deadline
  if (d.type === 'confirmed' && d.at) {
    const ms = d.at.getTime() - now.getTime()
    return {
      type: 'confirmed',
      at: d.at,
      timezone: d.timezone,
      source: d.source,
      countdownMs: ms,
      confidence: d.source ? 'high' : 'medium',
      lastCheckedAt: deal.lastVerifiedAt,
      headline: ms > 0 ? `Book by ${formatInZone(d.at, displayTimeZone ?? d.timezone)}` : 'Deadline has passed',
      detail: d.source ? `Documented deadline from ${d.source}.` : 'Deadline recorded without a source — verify before relying on it.',
    }
  }
  if (d.type === 'estimated') {
    return {
      type: 'estimated',
      at: null,
      timezone: null,
      source: d.source,
      countdownMs: null,
      confidence: 'low',
      lastCheckedAt: deal.lastVerifiedAt,
      headline: 'May be short-lived',
      detail: `${d.source ?? 'Historical patterns'} suggest similar deals have not lasted long. There is no guaranteed deadline.`,
    }
  }
  if (deal.availability === 'available' || d.type === 'observed') {
    return {
      type: 'observed',
      at: null,
      timezone: null,
      source: d.source,
      countdownMs: null,
      confidence: 'none',
      lastCheckedAt: deal.lastVerifiedAt,
      headline: deal.lastVerifiedAt ? 'Available at last check' : 'Availability not yet checked',
      detail: 'Award space can disappear at any time. No expiration date is known, so change alerts are used instead of a countdown.',
    }
  }
  return {
    type: 'none',
    at: null,
    timezone: null,
    source: null,
    countdownMs: null,
    confidence: 'none',
    lastCheckedAt: deal.lastVerifiedAt,
    headline: 'No known deadline',
    detail: 'No booking deadline has been documented for this deal.',
  }
}

/**
 * Reminders due for a confirmed deadline. If several reminders were missed
 * (e.g. the scheduler only runs daily) only the most recent one is sent and the
 * older ones are marked skipped, so the owner is not flooded.
 */
export function dueReminders(
  deadlineAt: Date,
  now: Date,
  alreadyHandled: ReadonlySet<ReminderOffsetId>,
  enabled: readonly ReminderOffsetId[] = REMINDER_OFFSETS.map((r) => r.id),
): { send: ReminderOffsetId | null; skip: ReminderOffsetId[] } {
  if (deadlineAt.getTime() <= now.getTime()) return { send: null, skip: [] }
  const due = REMINDER_OFFSETS.filter(
    (r) => enabled.includes(r.id) && !alreadyHandled.has(r.id) && deadlineAt.getTime() - r.minutes * 60_000 <= now.getTime(),
  )
  if (due.length === 0) return { send: null, skip: [] }
  // REMINDER_OFFSETS is ordered from earliest (7d) to latest (1h); the last due one is the most recent.
  const send = due[due.length - 1]!.id
  return { send, skip: due.slice(0, -1).map((r) => r.id) }
}
