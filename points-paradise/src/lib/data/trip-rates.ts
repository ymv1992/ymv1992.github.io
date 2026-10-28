import { and, eq } from 'drizzle-orm'
import type { AppDb } from '../db/client'
import { tripItems, trips, type TripRate } from '../db/schema'
import { fetchUsdRate } from '../providers/exchange-rates'
import { isKnownCurrency } from '../trips/money'
import { logJob } from './usage'

export interface RateDeps {
  fetch: typeof fetch
  now: Date
}

/** Currencies a trip needs rates for: its own currency and any used by its costs (never dollars). */
export async function tripCurrenciesInUse(db: AppDb, trip: { id: string; currency: string | null }): Promise<string[]> {
  const used = await db.selectDistinct({ c: tripItems.costCurrency }).from(tripItems).where(eq(tripItems.tripId, trip.id))
  return [...new Set([trip.currency, ...used.map((u) => u.c)].filter((c): c is string => !!c && c !== 'USD'))]
}

async function ownedRates(db: AppDb, userId: string, tripId: string): Promise<Record<string, TripRate> | null> {
  const [t] = await db.select({ rates: trips.rates }).from(trips).where(and(eq(trips.id, tripId), eq(trips.userId, userId)))
  return t ? t.rates : null
}

async function fetchAndLog(db: AppDb, code: string, deps: RateDeps): Promise<TripRate | null> {
  const startedAt = new Date()
  const { rate, requests } = await fetchUsdRate(code, deps.fetch)
  if (requests) {
    await logJob(db, {
      provider: rate?.source === 'currency_api' ? 'currency_api' : 'frankfurter',
      jobType: 'exchange_rate',
      params: { currency: code, found: !!rate, asOf: rate?.asOf ?? null },
      status: rate ? 'succeeded' : 'failed',
      startedAt,
      requestCount: requests,
      resultsCount: rate ? 1 : 0,
      error: rate ? undefined : `No free source has a rate for ${code}`,
    })
  }
  return rate
}

/**
 * Locks today's rate for each currency the trip doesn't have a rate for yet.
 * Rates already on the trip are left alone, so totals only change when the
 * owner asks. Returns the currencies still without a rate.
 */
export async function ensureTripRates(db: AppDb, userId: string, tripId: string, codes: string[], deps: RateDeps): Promise<string[]> {
  const rates = await ownedRates(db, userId, tripId)
  if (!rates) return []
  const wanted = [...new Set(codes)].filter((c) => isKnownCurrency(c) && c !== 'USD' && !rates[c])
  if (!wanted.length) return []
  const missing: string[] = []
  const added: Record<string, TripRate> = {}
  for (const code of wanted) {
    const rate = await fetchAndLog(db, code, deps)
    if (rate) added[code] = rate
    else missing.push(code)
  }
  if (Object.keys(added).length) {
    // Re-read so a rate saved meanwhile (another tab) isn't overwritten.
    const latest = (await ownedRates(db, userId, tripId)) ?? {}
    await db.update(trips).set({ rates: { ...added, ...latest }, updatedAt: deps.now }).where(and(eq(trips.id, tripId), eq(trips.userId, userId)))
  }
  return missing
}

/** Saves the owner's own rate ("1 USD = perUsd units"). */
export async function setTripRate(db: AppDb, userId: string, tripId: string, code: string, perUsd: number, now = new Date()): Promise<boolean> {
  if (!isKnownCurrency(code) || code === 'USD' || !(perUsd > 0) || perUsd > 1e9) return false
  const rates = await ownedRates(db, userId, tripId)
  if (!rates) return false
  await db
    .update(trips)
    .set({ rates: { ...rates, [code]: { perUsd, source: 'manual', asOf: now.toISOString().slice(0, 10) } }, updatedAt: now })
    .where(and(eq(trips.id, tripId), eq(trips.userId, userId)))
  return true
}

/** Replaces a currency's locked rate with today's (also replaces the owner's own rate). */
export async function refreshTripRate(db: AppDb, userId: string, tripId: string, code: string, deps: RateDeps): Promise<TripRate | null> {
  if (!isKnownCurrency(code) || code === 'USD') return null
  const rates = await ownedRates(db, userId, tripId)
  if (!rates) return null
  const rate = await fetchAndLog(db, code, deps)
  if (!rate) return null
  const latest = (await ownedRates(db, userId, tripId)) ?? rates
  await db
    .update(trips)
    .set({ rates: { ...latest, [code]: rate }, updatedAt: deps.now })
    .where(and(eq(trips.id, tripId), eq(trips.userId, userId)))
  return rate
}
