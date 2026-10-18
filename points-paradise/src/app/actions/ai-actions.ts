'use server'

import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { evaluateOne } from '@/lib/data/evaluation'
import { loadAccount } from '@/lib/data/account'
import { listPartners } from '@/lib/data/transfers'
import { destinationIdeas, explainDeal, factsKey, narrateTrip, type DestinationIdeas } from '@/lib/providers/ai'
import { requireUserId } from '@/lib/server/session'

export async function explainDealAction(dealId: string): Promise<{ ok: boolean; text: string }> {
  const userId = await requireUserId()
  if (!z.string().uuid().safeParse(dealId).success) return { ok: false, text: 'Invalid deal' }
  const db = await getDb()
  const one = await evaluateOne(db, userId, dealId)
  if (!one) return { ok: false, text: 'Deal not found' }
  if (!one.account.settings.aiEnabled) return { ok: false, text: 'AI explanations are turned off in Settings.' }
  const { evaluated: e } = one
  if (e.deal.sourceKind === 'demo') return { ok: false, text: 'AI explanations are not generated for fictional demo deals.' }
  // Only computed facts are sent — no personal data beyond the deal itself.
  const facts = {
    destination: `${e.deal.destination.city}, ${e.deal.destination.country}`,
    provider: e.deal.providerName,
    kind: e.deal.kind,
    cabin: e.deal.flight?.cabin ?? null,
    seat: e.deal.flight?.seatType ?? null,
    room: e.deal.hotel?.roomCategory ?? e.deal.hotel?.roomType ?? null,
    nights: e.deal.nights,
    program: e.deal.programId,
    programPoints: e.deal.programPoints,
    chasePoints: e.valuation.chasePoints,
    cashRequiredUsd: e.deal.mandatoryCashUsd,
    comparableCashUsd: e.deal.comparableCashUsd,
    headlineCentsPerPoint: e.valuation.headlineCpp != null ? Number(e.valuation.headlineCpp.toFixed(2)) : null,
    practicalCentsPerPoint: e.valuation.practicalCpp != null ? Number(e.valuation.practicalCpp.toFixed(2)) : null,
    ownerFloorCentsPerPoint: one.account.settings.pointFloorCents,
    evidenceStatus: e.statusLabel,
    warnings: e.valuation.flags.map((f) => f.message),
    comparabilityIssues: e.valuation.comparability.issues.map((i) => i.message),
    missingInformation: e.deal.missingInfo,
  }
  const res = await explainDeal({ db, monthlyBudgetUsd: one.account.settings.aiMonthlyBudgetUsd, jobType: 'explain_deal' }, facts)
  return res.ok ? { ok: true, text: res.value } : { ok: false, text: res.reason }
}

export async function destinationIdeasAction(): Promise<{ ok: boolean; ideas?: DestinationIdeas['ideas']; message?: string }> {
  const userId = await requireUserId()
  const db = await getDb()
  const account = await loadAccount(db, userId)
  if (!account.settings.aiEnabled) return { ok: false, message: 'AI ideas are turned off in Settings.' }
  const p = account.profile
  // Preferences only — no balances, emails or other personal data are sent.
  const profile = {
    loves: Object.entries(p.tagPreferences).filter(([, v]) => v === 2).map(([k]) => k),
    likes: Object.entries(p.tagPreferences).filter(([, v]) => v === 1).map(([k]) => k),
    avoids: Object.entries(p.tagPreferences).filter(([, v]) => v === -1).map(([k]) => k),
    tripStyles: p.tripStyles,
    dreamDestinations: p.dreamDestinations,
    alreadyVisited: p.visited,
    homeAirports: p.homeAirports,
    maxFlightHours: p.maxFlightHours,
  }
  const programs = (await listPartners(db)).filter((x) => x.active).map((x) => x.programName)
  const res = await destinationIdeas({ db, monthlyBudgetUsd: account.settings.aiMonthlyBudgetUsd, jobType: 'destination_ideas', cacheKey: factsKey('ideas', { profile, programs, month: new Date().toISOString().slice(0, 7) }) }, profile, programs)
  return res.ok ? { ok: true, ideas: res.value.ideas } : { ok: false, message: res.reason }
}

export async function narrateTripAction(facts: Record<string, unknown>): Promise<{ ok: boolean; text: string }> {
  const userId = await requireUserId()
  const db = await getDb()
  const account = await loadAccount(db, userId)
  if (!account.settings.aiEnabled) return { ok: false, text: 'AI is turned off in Settings.' }
  const safe = z.record(z.string(), z.unknown()).safeParse(facts)
  if (!safe.success || JSON.stringify(facts).length > 20_000) return { ok: false, text: 'Invalid trip facts' }
  const res = await narrateTrip({ db, monthlyBudgetUsd: account.settings.aiMonthlyBudgetUsd, jobType: 'narrate_trip' }, safe.data)
  return res.ok ? { ok: true, text: res.value } : { ok: false, text: res.reason }
}
