import { and, eq, gt, isNull, lte } from 'drizzle-orm'
import type { AppDb } from '../db/client'
import { announcements, appState, dataSources, deals, mediaCache, transferPromotions, users, watchlists } from '../db/schema'
import { REMINDER_OFFSETS, type ReminderOffsetId } from '../domain/constants'
import { dueReminders } from '../engine/deadlines'
import { planBatch, priorityScore, type QueueCandidate } from '../engine/priority'
import { DEFAULT_ALERT_PREFS } from '../data/account'
import { archiveExpiredDeals, upsertDeal } from '../data/deals'
import { loadEvaluationData } from '../data/evaluation'
import {
  flushDeferred,
  handledReminderOffsets,
  notify,
  recordSkippedReminders,
  sendDailyDigest,
  toAlertPreferences,
  type DeliveryConfig,
  type EmailSender,
} from '../data/notifications'
import { listSaved, refreshSavedSnapshot } from '../data/saved'
import { lookupCashPrice, RECHECK_DAYS } from '../data/cash-prices'
import { dayStart, logJob, requestsSince } from '../data/usage'
import { cachedSearch, itemToDealColumns, searchDiagnostics } from '../providers/seats-aero'
import { searchDestinationPhoto } from '../providers/unsplash'
import { fetchFeed, matchKeywords } from '../providers/rss'
import { DISCOVERY_METHOD, runDiscovery, type DiscoveryLimits } from './discovery'
import { HOTEL_METHOD, runHotelDiscovery } from './hotel-discovery'
import { cpp as fmtCpp, points as fmtPoints } from '../format'

export interface JobDeps {
  now: Date
  sendEmail: EmailSender | null
  appUrl: string
  keys: { seatsAero: string | null; serpApi: string | null; unsplash: string | null }
  rssFeeds: string[]
  fetch: typeof fetch
}

export type JobMode = 'daily' | 'frequent' | 'manual' | 'discover'

export interface JobSummary {
  mode: JobMode
  archived: number
  notifications: number
  watchChecks: number
  /** New flight deals found by automatic discovery. */
  discovered: number
  /** New hotel deals found by automatic hotel discovery. */
  hotels: number
  enriched: number
  photos: number
  announcements: number
  skipped: string[]
  errors: string[]
}

const DAY = 86_400_000
const MAX_DISCOVERY_VALUE_ALERTS = 3

/** seats.aero discovery calls per run; the daily cap in discovery.ts applies on top. */
const DISCOVERY_LIMITS: Record<JobMode, DiscoveryLimits> = {
  discover: { maxCalls: 30, timeBudgetMs: 25_000 },
  manual: { maxCalls: 6, timeBudgetMs: 15_000 },
  frequent: { maxCalls: 3, timeBudgetMs: 8_000 },
  daily: { maxCalls: 0, timeBudgetMs: 0 },
}

/** rooms.aero hotel searches per run; the daily cap in hotel-discovery.ts applies on top. */
const HOTEL_LIMITS: Record<JobMode, DiscoveryLimits> = {
  discover: { maxCalls: 16, timeBudgetMs: 18_000 },
  manual: { maxCalls: 8, timeBudgetMs: 12_000 },
  frequent: { maxCalls: 4, timeBudgetMs: 6_000 },
  daily: { maxCalls: 0, timeBudgetMs: 0 },
}

async function getState<T>(db: AppDb, key: string): Promise<T | null> {
  const [row] = await db.select().from(appState).where(eq(appState.key, key))
  return row ? (row.value as T) : null
}

async function setState(db: AppDb, key: string, value: unknown, now: Date) {
  await db.insert(appState).values({ key, value }).onConflictDoUpdate({ target: appState.key, set: { value, updatedAt: now } })
}

async function source(db: AppDb, id: string) {
  const [row] = await db.select().from(dataSources).where(eq(dataSources.id, id))
  return row ?? null
}

/**
 * Runs the scheduled work. "frequent" covers time-sensitive alerts and due
 * watch checks; "daily" adds archiving, enrichment, photos, RSS and digests.
 * Every external call is gated by configuration, quotas and the spend cap.
 */
export async function runJobs(db: AppDb, deps: JobDeps, mode: JobMode, onlyUserId?: string): Promise<JobSummary> {
  const now = deps.now
  const summary: JobSummary = { mode, archived: 0, notifications: 0, watchChecks: 0, discovered: 0, hotels: 0, enriched: 0, photos: 0, announcements: 0, skipped: [], errors: [] }
  const userRows = await db.select({ id: users.id }).from(users)
  const userIds = userRows.map((u) => u.id).filter((id) => !onlyUserId || id === onlyUserId)

  if (mode === 'discover') {
    for (const userId of userIds) await discover(db, deps, userId, mode, summary)
    return summary
  }

  summary.archived = (await archiveExpiredDeals(db, now)).length

  for (const userId of userIds) {
    // Watch checks and discovery first so alerts below see fresh observations.
    await runWatchChecks(db, deps, userId, mode, summary)
    if (DISCOVERY_LIMITS[mode].maxCalls > 0) await discover(db, deps, userId, mode, summary)
    if (mode !== 'frequent') await recomputeCachedMetrics(db, userId, now)
    if (mode !== 'frequent') {
      await enrichCashPrices(db, deps, userId, summary)
      await fetchPhotos(db, deps, summary)
    }
    await evaluateAlerts(db, deps, userId, summary)
  }
  if (mode !== 'frequent') await ingestRss(db, deps, summary)
  return summary
}

async function discover(db: AppDb, deps: JobDeps, userId: string, mode: JobMode, summary: JobSummary) {
  const r = await runDiscovery(db, userId, { now: deps.now, apiKey: deps.keys.seatsAero, fetch: deps.fetch }, DISCOVERY_LIMITS[mode])
  summary.discovered += r.newDeals
  summary.skipped.push(...r.skipped)
  summary.errors.push(...r.errors)
  if (HOTEL_LIMITS[mode].maxCalls > 0) {
    const h = await runHotelDiscovery(db, userId, { now: deps.now, apiKey: deps.keys.seatsAero, fetch: deps.fetch }, HOTEL_LIMITS[mode])
    summary.hotels += h.newDeals
    summary.skipped.push(...h.skipped)
    summary.errors.push(...h.errors)
  }
}

async function deliveryConfig(db: AppDb, deps: JobDeps, userId: string): Promise<{ cfg: DeliveryConfig; data: Awaited<ReturnType<typeof loadEvaluationData>> }> {
  const data = await loadEvaluationData(db, userId, { now: deps.now })
  const s = data.account.settings
  return {
    data,
    cfg: {
      prefs: toAlertPreferences(s.alertPrefs ?? DEFAULT_ALERT_PREFS, s.timezone),
      emailEnabled: s.emailEnabled,
      emailTo: s.notificationEmail,
      sendEmail: deps.sendEmail,
      appUrl: deps.appUrl,
    },
  }
}

async function evaluateAlerts(db: AppDb, deps: JobDeps, userId: string, summary: JobSummary) {
  const now = deps.now
  const { cfg, data } = await deliveryConfig(db, deps, userId)
  const prefs = data.account.settings.alertPrefs ?? DEFAULT_ALERT_PREFS
  const enabledOffsets = (prefs.reminderOffsets ?? REMINDER_OFFSETS.map((r) => r.id)) as ReminderOffsetId[]
  const count = (r: { created: boolean; status: string }) => {
    if (r.created && r.status !== 'suppressed') summary.notifications++
  }

  // Saved deals: price changes, value changes, deadlines.
  const saved = await listSaved(db, userId)
  for (const s of saved) {
    const e = data.byId.get(s.dealId)
    if (!e || e.deal.sourceKind === 'demo') continue
    const v = e.valuation
    const label = `${e.deal.destination.city} — ${e.deal.providerName}`
    if (s.alertPriceDrop && v.chasePoints != null && s.latestChasePoints != null && v.chasePoints <= s.latestChasePoints * 0.95) {
      count(
        await notify(
          db,
          userId,
          {
            type: 'saved_price_drop',
            dealId: e.deal.id,
            discriminator: `pts=${v.chasePoints}`,
            cpp: v.practicalCpp,
            chasePoints: v.chasePoints,
            cashUsd: e.deal.mandatoryCashUsd,
            destination: e.deal.destination.city,
            cabin: e.deal.flight?.cabin ?? null,
            travelStart: e.deal.travelStart,
            title: `Price drop: ${label}`,
            body: `Now ${fmtPoints(v.chasePoints)} Chase points (was ${fmtPoints(s.latestChasePoints)}). ${e.statusLabel}.`,
            link: `/deals/${e.deal.id}`,
          },
          cfg,
          now,
        ),
      )
    }
    const cppNow = v.practicalCpp ?? v.headlineCpp
    if (cppNow != null && s.latestCpp != null && cppNow - s.latestCpp >= 0.5) {
      count(
        await notify(
          db,
          userId,
          {
            type: 'cpp_improvement',
            dealId: e.deal.id,
            discriminator: `cpp=${cppNow.toFixed(1)}`,
            cpp: cppNow,
            chasePoints: v.chasePoints,
            destination: e.deal.destination.city,
            title: `Better value: ${label}`,
            body: `Now ${fmtCpp(cppNow)} per point (was ${fmtCpp(s.latestCpp)}).`,
            link: `/deals/${e.deal.id}`,
          },
          cfg,
          now,
        ),
      )
    }
    await refreshSavedSnapshot(db, s.id, { programPoints: e.deal.programPoints, chasePoints: v.chasePoints, cpp: cppNow }, now)

    if (s.alertDeadline && e.deadline.type === 'confirmed' && e.deadline.at) {
      const handled = await handledReminderOffsets(db, userId, e.deal.id)
      const { send, skip } = dueReminders(e.deadline.at, now, handled, enabledOffsets)
      await recordSkippedReminders(db, userId, e.deal.id, skip, now)
      if (send) {
        const label2 = REMINDER_OFFSETS.find((r) => r.id === send)?.label ?? send
        count(
          await notify(
            db,
            userId,
            {
              type: 'deadline_reminder',
              dealId: e.deal.id,
              discriminator: send,
              urgent: true,
              title: `Book soon: ${label}`,
              body: `${e.deadline.headline} (${label2}). Source: ${e.deadline.source ?? 'recorded deadline'}.`,
              link: `/deals/${e.deal.id}`,
            },
            cfg,
            now,
          ),
        )
      }
    }
  }

  // Transfer bonuses ending within 72 hours.
  const ending = await db
    .select()
    .from(transferPromotions)
    .where(and(gt(transferPromotions.endsAt, now), lte(transferPromotions.endsAt, new Date(now.getTime() + 3 * DAY))))
  for (const p of ending) {
    const partner = data.partners.get(p.partnerId)
    count(
      await notify(
        db,
        userId,
        {
          type: 'transfer_bonus_ending',
          promotionId: p.id,
          discriminator: 'ending-72h',
          urgent: true,
          title: `${p.bonusPercent}% bonus to ${partner?.programName ?? p.partnerId} ends soon`,
          body: `Ends ${p.endsAt!.toISOString().replace('T', ' ').slice(0, 16)} UTC. Only transfer for a confirmed award.`,
          link: '/transfers',
        },
        cfg,
        now,
      ),
    )
  }

  // New deals since the last run: exceptional value and dream destinations.
  const lastKey = `jobs:lastAlertRun:${userId}`
  const last = await getState<{ at: string }>(db, lastKey)
  const since = last ? new Date(last.at) : new Date(now.getTime() - DAY)
  // Discovery can add many finds at once: alert on the cheapest per dream city (flights and hotels
  // separately) and on at most MAX_DISCOVERY_VALUE_ALERTS of the best-value finds per run.
  const fromDiscovery = (e: (typeof data.items)[number]) => e.deal.verificationMethod === DISCOVERY_METHOD || e.deal.verificationMethod === HOTEL_METHOD
  const dreamPick = new Map<string, { id: string; points: number }>()
  for (const e of data.items) {
    if (!fromDiscovery(e) || e.deal.firstSeenAt <= since) continue
    if (!e.match.reasons.some((r) => r.startsWith('Dream destination'))) continue
    const points = e.valuation.chasePoints ?? Infinity
    const key = `${e.deal.kind}|${e.deal.destination.city}`
    const cur = dreamPick.get(key)
    if (!cur || points < cur.points) dreamPick.set(key, { id: e.deal.id, points })
  }
  const valueAllowed = new Set(
    data.items
      .filter((e) => fromDiscovery(e) && e.deal.firstSeenAt > since && (e.valuation.practicalCpp ?? e.valuation.headlineCpp) != null)
      .sort((a, b) => (b.valuation.practicalCpp ?? b.valuation.headlineCpp ?? 0) - (a.valuation.practicalCpp ?? a.valuation.headlineCpp ?? 0))
      .slice(0, MAX_DISCOVERY_VALUE_ALERTS)
      .map((e) => e.deal.id),
  )
  for (const e of data.items) {
    if (e.deal.sourceKind === 'demo' || e.deal.firstSeenAt <= since) continue
    if (e.status === 'expired' || e.status === 'unavailable') continue
    const value = e.valuation.practicalCpp ?? e.valuation.headlineCpp
    const label = `${e.deal.destination.city} — ${e.deal.providerName}`
    if (value != null && value >= (prefs.minCpp ?? 3) && (!fromDiscovery(e) || valueAllowed.has(e.deal.id))) {
      count(
        await notify(
          db,
          userId,
          {
            type: 'new_exceptional_deal',
            dealId: e.deal.id,
            discriminator: 'new',
            cpp: value,
            chasePoints: e.valuation.chasePoints,
            cashUsd: e.deal.mandatoryCashUsd,
            destination: e.deal.destination.city,
            cabin: e.deal.flight?.cabin ?? null,
            hotelCategory: e.deal.hotel?.programCategory ?? null,
            travelStart: e.deal.travelStart,
            title: `New: ${label} at ${fmtCpp(value)}/pt`,
            body: `${fmtPoints(e.valuation.chasePoints)} Chase points + $${Math.round(e.deal.mandatoryCashUsd ?? 0)}. Evidence: ${e.statusLabel}.`,
            link: `/deals/${e.deal.id}`,
          },
          cfg,
          now,
        ),
      )
    }
    const dreamAllowed = !fromDiscovery(e) || dreamPick.get(`${e.deal.kind}|${e.deal.destination.city}`)?.id === e.deal.id
    if (dreamAllowed && e.match.reasons.some((r) => r.startsWith('Dream destination'))) {
      count(
        await notify(
          db,
          userId,
          {
            type: 'dream_destination_match',
            dealId: e.deal.id,
            discriminator: 'new',
            cpp: value,
            chasePoints: e.valuation.chasePoints,
            destination: e.deal.destination.city,
            title: `Dream destination: ${e.deal.destination.city}`,
            body: `${label}. ${value != null ? `${fmtCpp(value)} per point.` : 'Value not yet calculable.'}`,
            link: `/deals/${e.deal.id}`,
          },
          cfg,
          now,
        ),
      )
    }
  }
  await setState(db, lastKey, { at: now.toISOString() }, now)

  await flushDeferred(db, userId, cfg, now)
  await sendDailyDigest(db, userId, cfg, now)
}

async function runWatchChecks(db: AppDb, deps: JobDeps, userId: string, mode: JobMode, summary: JobSummary) {
  const now = deps.now
  const watches = await db
    .select()
    .from(watchlists)
    .where(and(eq(watchlists.userId, userId), eq(watchlists.active, true), eq(watchlists.provider, 'seats_aero')))
  if (watches.length === 0) return
  if (!deps.keys.seatsAero) {
    summary.skipped.push('seats.aero watch checks: SEATS_AERO_API_KEY not set')
    return
  }
  const src = await source(db, 'seats_aero')
  if (src && !src.enabled) {
    summary.skipped.push('seats.aero disabled')
    return
  }
  const usedToday = await requestsSince(db, 'seats_aero', dayStart(now))
  const quotaLeft = Math.max(0, (src?.dailyQuota ?? 1000) - usedToday)
  const candidates: QueueCandidate[] = watches.map((w) => ({
    key: w.id,
    kind: w.kind === 'deal' ? 'saved_deal' : 'watchlist',
    provider: 'seats_aero',
    lastCheckedAt: w.lastCheckedAt,
    refreshHours: w.refreshHours,
    unchangedStreak: w.unchangedStreak,
    estimatedCostUsd: src?.costPerRequestUsd ?? 0,
  }))
  const plan = planBatch(candidates, now, { maxRequests: mode === 'frequent' ? 10 : 50, budgetRemainingUsd: Infinity, perProviderRemaining: { seats_aero: quotaLeft } })
  for (const c of plan.skippedBudget) {
    await logJob(db, { provider: 'seats_aero', jobType: 'watch_check', params: { watchId: c.key }, status: 'skipped_quota', startedAt: now, error: 'Daily request quota reached' })
  }
  const { cfg } = await deliveryConfig(db, deps, userId)
  for (const c of plan.selected) {
    const w = watches.find((x) => x.id === c.key)!
    const cabin = (w.cabin ?? 'business') as 'economy' | 'premium_economy' | 'business' | 'first'
    const startDate = w.dateFrom && w.dateFrom > now.toISOString().slice(0, 10) ? w.dateFrom : now.toISOString().slice(0, 10)
    const endDate = w.dateTo ?? new Date(now.getTime() + 60 * DAY).toISOString().slice(0, 10)
    const startedAt = new Date()
    try {
      const res = await cachedSearch(deps.keys.seatsAero, { origins: w.origins, destinations: w.destinations, cabin, startDate, endDate }, deps.fetch)
      const mapped = res.items.map((i) => itemToDealColumns(i, cabin)).filter((x): x is NonNullable<typeof x> => x !== null)
      const relevant = mapped.filter((m) => {
        if (w.programId && m.programId !== w.programId) return false
        if (w.criteria.maxProgramPoints != null && (m.programPoints ?? Infinity) > w.criteria.maxProgramPoints) return false
        return true
      })
      let changed = false
      const seenKeys = new Set<string>()
      for (const m of relevant) {
        const { verifiedAt, ...cols } = m
        seenKeys.add(cols.dedupeKey)
        const up = await upsertDeal(db, cols, { now, verified: true, verifiedAt: verifiedAt ?? now, historySource: 'seats_aero' })
        if (up.isNew || up.change.significant) {
          changed = true
          const r = await notify(
            db,
            userId,
            {
              type: 'availability_observed',
              dealId: up.id,
              discriminator: `pts=${cols.programPoints}`,
              chasePoints: cols.programPoints,
              destination: cols.destCity,
              cabin,
              travelStart: cols.travelStart,
              title: `Award space: ${cols.originAirport} → ${cols.destAirport} on ${cols.travelStart}`,
              body: `${fmtPoints(cols.programPoints)} ${cols.programId} miles in ${cabin.replace('_', ' ')} (seats.aero cached result — verify before transferring).`,
              link: `/deals/${up.id}`,
            },
            cfg,
            now,
          )
          if (r.created && r.status !== 'suppressed') summary.notifications++
        }
      }
      // A watched deal that is no longer returned for its date is marked unavailable.
      if (w.dealId) {
        const [deal] = await db.select().from(deals).where(eq(deals.id, w.dealId))
        if (deal && deal.travelStart && deal.travelStart >= startDate && deal.travelStart <= endDate && !seenKeys.has(deal.dedupeKey) && deal.availability === 'available') {
          await db.update(deals).set({ availability: 'unavailable', lastVerifiedAt: now, verificationMethod: 'seats.aero cached search', updatedAt: now }).where(eq(deals.id, deal.id))
          changed = true
          const r = await notify(
            db,
            userId,
            {
              type: 'availability_lost',
              dealId: deal.id,
              discriminator: now.toISOString().slice(0, 10),
              title: `No longer showing: ${deal.title}`,
              body: 'The latest seats.aero cached search no longer shows this award. Check the airline site before relying on it.',
              link: `/deals/${deal.id}`,
            },
            cfg,
            now,
          )
          if (r.created && r.status !== 'suppressed') summary.notifications++
        }
      }
      const hash = [...seenKeys].sort().join('|').slice(0, 2000)
      const unchanged = !changed && hash === (w.lastResultHash ?? '')
      await db
        .update(watchlists)
        .set({ lastCheckedAt: now, lastResultHash: hash, unchangedStreak: unchanged ? w.unchangedStreak + 1 : 0, lastError: null })
        .where(eq(watchlists.id, w.id))
      await logJob(db, {
        provider: 'seats_aero',
        jobType: 'watch_check',
        params: { watchId: w.id, origins: w.origins, destinations: w.destinations, cabin, startDate, endDate, ...searchDiagnostics(res) },
        status: 'succeeded',
        startedAt,
        requestCount: res.requests,
        estimatedCostUsd: src?.costPerRequestUsd ?? 0,
        resultsCount: relevant.length,
        priority: priorityScore(c, now),
      })
      summary.watchChecks++
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Watch check failed'
      await db.update(watchlists).set({ lastCheckedAt: now, lastError: message }).where(eq(watchlists.id, w.id))
      await logJob(db, { provider: 'seats_aero', jobType: 'watch_check', params: { watchId: w.id }, status: 'failed', startedAt, requestCount: 1, error: message })
      summary.errors.push(`watch ${w.label}: ${message}`)
    }
  }
}

const CABIN_PRIORITY: Record<string, number> = { first: 0, business: 1, premium_economy: 2, economy: 3 }

/**
 * Adds comparable cash prices to a few discovered deals per run: saved deals
 * first, then first and business class (where points value matters most),
 * then fewest points. Deals looked up recently are skipped, priced or not.
 */
async function enrichCashPrices(db: AppDb, deps: JobDeps, userId: string, summary: JobSummary) {
  if (!deps.keys.serpApi) return
  const now = deps.now
  const data = await loadEvaluationData(db, userId, { now })
  const today = now.toISOString().slice(0, 10)
  const recent = now.getTime() - RECHECK_DAYS * DAY
  const todo = data.items
    .filter(
      (e) =>
        e.deal.sourceKind === 'api' &&
        e.deal.comparableCashUsd == null &&
        e.deal.travelStart != null &&
        e.deal.travelStart > today &&
        (e.deal.comparableCashObservedAt == null || e.deal.comparableCashObservedAt.getTime() < recent),
    )
    .sort(
      (a, b) =>
        Number(data.savedIds.has(b.deal.id)) - Number(data.savedIds.has(a.deal.id)) ||
        (CABIN_PRIORITY[a.deal.flight?.cabin ?? ''] ?? 4) - (CABIN_PRIORITY[b.deal.flight?.cabin ?? ''] ?? 4) ||
        (a.deal.programPoints ?? 0) - (b.deal.programPoints ?? 0),
    )
    .slice(0, 5)
  for (const e of todo) {
    const r = await lookupCashPrice(db, e.deal, { apiKey: deps.keys.serpApi, now, fetch: deps.fetch, monthlyCapUsd: data.account.settings.monthlyApiBudgetUsd, jobType: 'cash_enrichment' })
    if (r.status === 'priced') summary.enriched++
    else if (r.status === 'failed') summary.errors.push(r.reason)
    else if (r.status === 'skipped') {
      summary.skipped.push(r.reason)
      break
    }
  }
}

async function fetchPhotos(db: AppDb, deps: JobDeps, summary: JobSummary) {
  if (!deps.keys.unsplash) return
  const now = deps.now
  const missing = await db
    .select({ city: deals.destCity, country: deals.destCountry })
    .from(deals)
    .where(and(isNull(deals.imageUrl), isNull(deals.archivedAt)))
    .groupBy(deals.destCity, deals.destCountry)
    .limit(10)
  for (const m of missing) {
    const query = `${m.city}, ${m.country}`.slice(0, 100)
    let [cached] = await db.select().from(mediaCache).where(eq(mediaCache.query, query))
    if (!cached || now.getTime() - cached.fetchedAt.getTime() > 30 * DAY) {
      const startedAt = new Date()
      try {
        const photo = await searchDestinationPhoto(deps.keys.unsplash, query, deps.fetch)
        await logJob(db, { provider: 'unsplash', jobType: 'photo', params: { query }, status: 'succeeded', startedAt, requestCount: 1, resultsCount: photo ? 1 : 0 })
        if (!photo) continue
        const row = { query, url: photo.url, thumbUrl: photo.thumbUrl, creditName: photo.creditName, creditUrl: photo.creditUrl, provider: 'unsplash', fetchedAt: now }
        await db.insert(mediaCache).values(row).onConflictDoUpdate({ target: mediaCache.query, set: row })
        cached = row
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Photo lookup failed'
        await logJob(db, { provider: 'unsplash', jobType: 'photo', status: 'failed', startedAt, requestCount: 1, error: message })
        summary.errors.push(message)
        continue
      }
    }
    await db
      .update(deals)
      .set({ imageUrl: cached.url, imageCredit: `Photo: ${cached.creditName} / Unsplash` })
      .where(and(eq(deals.destCity, m.city), eq(deals.destCountry, m.country), isNull(deals.imageUrl)))
    summary.photos++
  }
}

async function ingestRss(db: AppDb, deps: JobDeps, summary: JobSummary) {
  for (const feed of deps.rssFeeds) {
    const startedAt = new Date()
    try {
      const items = await fetchFeed(feed, deps.fetch)
      const matches = items
        .map((i) => ({ i, k: matchKeywords(i.title) }))
        .filter((x): x is { i: (typeof items)[number]; k: string[] } => x.k !== null)
      if (matches.length) {
        const inserted = await db
          .insert(announcements)
          .values(matches.map(({ i, k }) => ({ feedUrl: feed, title: i.title, url: i.url, publishedAt: i.publishedAt, matchedKeywords: k })))
          .onConflictDoNothing()
          .returning({ id: announcements.id })
        summary.announcements += inserted.length
      }
      await logJob(db, { provider: 'rss_announcements', jobType: 'rss', params: { feed }, status: 'succeeded', startedAt, requestCount: 1, resultsCount: matches.length })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Feed failed'
      await logJob(db, { provider: 'rss_announcements', jobType: 'rss', params: { feed }, status: 'failed', startedAt, requestCount: 1, error: message })
      summary.errors.push(`${feed}: ${message}`)
    }
  }
}

/** Recomputes the denormalised value columns used for indexes. */
export async function recomputeCachedMetrics(db: AppDb, userId: string, now: Date): Promise<number> {
  const data = await loadEvaluationData(db, userId, { now })
  let n = 0
  for (const e of data.items) {
    await db
      .update(deals)
      .set({ cachedCpp: e.valuation.practicalCpp ?? e.valuation.headlineCpp, cachedChasePoints: e.valuation.chasePoints })
      .where(eq(deals.id, e.deal.id))
    n++
  }
  return n
}
