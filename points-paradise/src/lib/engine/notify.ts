import type { Cabin } from '../domain/constants'

export const ALERT_EVENT_TYPES = [
  'new_exceptional_deal',
  'saved_price_drop',
  'availability_observed',
  'availability_lost',
  'transfer_bonus_new',
  'transfer_bonus_ending',
  'deadline_reminder',
  'cpp_improvement',
  'dream_destination_match',
  'positioning_opportunity',
  'deal_reappeared',
  'watch_check_failed',
] as const
export type AlertEventType = (typeof ALERT_EVENT_TYPES)[number]

export const ALERT_EVENT_LABELS: Record<AlertEventType, string> = {
  new_exceptional_deal: 'New exceptional deals',
  saved_price_drop: 'Saved-deal price drops',
  availability_observed: 'Newly observed award availability',
  availability_lost: 'Saved deals no longer available',
  transfer_bonus_new: 'New transfer bonuses',
  transfer_bonus_ending: 'Transfer bonuses ending soon',
  deadline_reminder: 'Confirmed booking deadlines',
  cpp_improvement: 'Significant value improvements',
  dream_destination_match: 'Dream destination matches',
  positioning_opportunity: 'Better positioning opportunities',
  deal_reappeared: 'Historical deals available again',
  watch_check_failed: 'Watch check problems',
}

export interface AlertPreferences {
  enabledTypes: AlertEventType[]
  minCpp: number | null
  maxPoints: number | null
  maxCashUsd: number | null
  destinations: string[]
  cabins: Cabin[]
  hotelCategories: string[]
  travelFrom: string | null
  travelTo: string | null
  urgentOnly: boolean
  frequency: 'instant' | 'daily'
  quietHoursStart: string | null
  quietHoursEnd: string | null
  timeZone: string
}

export interface AlertEvent {
  type: AlertEventType
  dealId?: string | null
  promotionId?: string | null
  /** Distinguishes repeat events for the same subject, e.g. the new points price or reminder offset. */
  discriminator: string
  cpp?: number | null
  chasePoints?: number | null
  cashUsd?: number | null
  destination?: string | null
  cabin?: Cabin | null
  hotelCategory?: string | null
  travelStart?: string | null
  urgent?: boolean
}

/** Stable key used with a unique index to guarantee a notification is created at most once. */
export function notificationKey(e: Pick<AlertEvent, 'type' | 'dealId' | 'promotionId' | 'discriminator'>): string {
  const subject = e.dealId ? `deal:${e.dealId}` : e.promotionId ? `promo:${e.promotionId}` : 'global'
  return `${e.type}|${subject}|${e.discriminator}`
}

function minutesOfDay(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/** Quiet hours may wrap past midnight (e.g. 22:00–07:00). */
export function isInQuietHours(now: Date, start: string | null, end: string | null, timeZone: string): boolean {
  if (!start || !end) return false
  const s = minutesOfDay(start)
  const e = minutesOfDay(end)
  if (s == null || e == null || s === e) return false
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).formatToParts(now)
  } catch {
    parts = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' }).formatToParts(now)
  }
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0)
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  const t = hour * 60 + minute
  return s < e ? t >= s && t < e : t >= s || t < e
}

export type AlertDecision = { action: 'send' | 'defer' | 'digest' | 'suppress'; reason: string }

/** Applies the owner's alert criteria. Deadline reminders bypass value filters but respect quiet hours. */
export function decideAlert(e: AlertEvent, prefs: AlertPreferences, now: Date): AlertDecision {
  if (!prefs.enabledTypes.includes(e.type)) return { action: 'suppress', reason: 'Alert type disabled' }
  const valueFiltered =
    e.type !== 'deadline_reminder' && e.type !== 'transfer_bonus_ending' && e.type !== 'watch_check_failed' && e.type !== 'availability_lost'
  if (valueFiltered) {
    if (prefs.minCpp != null && e.cpp != null && e.cpp < prefs.minCpp) return { action: 'suppress', reason: 'Below minimum CPP' }
    if (prefs.maxPoints != null && e.chasePoints != null && e.chasePoints > prefs.maxPoints) return { action: 'suppress', reason: 'Above maximum points' }
    if (prefs.maxCashUsd != null && e.cashUsd != null && e.cashUsd > prefs.maxCashUsd) return { action: 'suppress', reason: 'Above maximum cash' }
    if (prefs.destinations.length > 0 && e.destination) {
      const d = e.destination.toLowerCase()
      if (!prefs.destinations.some((p) => d.includes(p.toLowerCase()))) return { action: 'suppress', reason: 'Not a preferred destination' }
    }
    if (prefs.cabins.length > 0 && e.cabin && !prefs.cabins.includes(e.cabin)) return { action: 'suppress', reason: 'Cabin not selected' }
    if (prefs.hotelCategories.length > 0 && e.hotelCategory) {
      const c = e.hotelCategory.toLowerCase()
      if (!prefs.hotelCategories.some((h) => c.includes(h.toLowerCase()))) return { action: 'suppress', reason: 'Hotel category not selected' }
    }
    if (e.travelStart) {
      if (prefs.travelFrom && e.travelStart < prefs.travelFrom) return { action: 'suppress', reason: 'Outside travel dates' }
      if (prefs.travelTo && e.travelStart > prefs.travelTo) return { action: 'suppress', reason: 'Outside travel dates' }
    }
    if (prefs.urgentOnly && !e.urgent) return { action: 'suppress', reason: 'Only urgent alerts enabled' }
  }
  if (prefs.frequency === 'daily' && e.type !== 'deadline_reminder') return { action: 'digest', reason: 'Daily digest' }
  if (isInQuietHours(now, prefs.quietHoursStart, prefs.quietHoursEnd, prefs.timeZone)) return { action: 'defer', reason: 'Quiet hours' }
  return { action: 'send', reason: 'Matches alert criteria' }
}
