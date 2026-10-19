import { TAG_LABELS, type CategorySlug, type DateFlexibility, type DealBreaker, type TravelTag } from '../domain/constants'
import type { Deal } from '../domain/types'
import { LONG_HAUL_MINUTES } from './geo'

/** -1 avoid, 0 neutral, 1 like, 2 love */
export type TagPreference = -1 | 0 | 1 | 2

export interface ProfilePreferences {
  tagPreferences: Partial<Record<TravelTag, TagPreference>>
  learnedWeights: Partial<Record<string, number>>
  tripNightsMin: number | null
  tripNightsMax: number | null
  maxFlightHours: number | null
  dateFlexibility: DateFlexibility
  visited: string[]
  dreamDestinations: string[]
  dealBreakers: DealBreaker[]
  preferredCategories: CategorySlug[]
  preferNewPlaces: boolean
}

export interface PersonalMatch {
  /** 0–100 */
  score: number
  excluded: boolean
  reasons: string[]
  exclusions: string[]
}

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

function placeMatches(list: readonly string[], deal: Pick<Deal, 'destination'>): string | null {
  const city = normalize(deal.destination.city)
  const country = normalize(deal.destination.country)
  const cc = (deal.destination.countryCode ?? '').toLowerCase()
  for (const raw of list) {
    const p = normalize(raw)
    if (!p) continue
    if (p === city || p === country || p === cc || city.includes(p) || (p.length > 3 && country.includes(p))) return raw
  }
  return null
}

/**
 * How well a deal fits the owner. This is deliberately separate from
 * redemption value: a high CPP does not make a destination desirable.
 */
export function personalMatch(deal: Deal, prefs: ProfilePreferences, dealCategories: readonly CategorySlug[] = []): PersonalMatch {
  const reasons: string[] = []
  const exclusions: string[] = []
  let score = 50

  const loved: string[] = []
  const liked: string[] = []
  const avoided: string[] = []
  for (const tag of deal.tags) {
    const pref = prefs.tagPreferences[tag as TravelTag] ?? 0
    const learned = Math.max(-1, Math.min(1, prefs.learnedWeights[tag] ?? 0))
    score += pref * 9 + learned * 12
    const label = TAG_LABELS[tag as TravelTag] ?? tag
    if (pref === 2) loved.push(label)
    else if (pref === 1) liked.push(label)
    else if (pref === -1) avoided.push(label)
  }
  if (loved.length) reasons.push(`You love: ${loved.join(', ')}`)
  if (liked.length) reasons.push(`You like: ${liked.join(', ')}`)
  if (avoided.length) reasons.push(`You avoid: ${avoided.join(', ')}`)

  const dream = placeMatches(prefs.dreamDestinations, deal)
  if (dream) {
    score += 25
    reasons.push(`Dream destination: ${dream}`)
  }
  const visited = placeMatches(prefs.visited, deal)
  if (visited && prefs.preferNewPlaces) {
    score -= 12
    reasons.push(`Already visited: ${visited}`)
  }

  if (deal.nights != null && (prefs.tripNightsMin != null || prefs.tripNightsMax != null)) {
    const min = prefs.tripNightsMin ?? 0
    const max = prefs.tripNightsMax ?? Infinity
    if (deal.nights >= min && deal.nights <= max) score += 5
    else {
      score -= 6
      reasons.push(`${deal.nights} nights is outside your preferred trip length`)
    }
  }

  const preferredHits = dealCategories.filter((c) => prefs.preferredCategories.includes(c))
  if (preferredHits.length) score += Math.min(12, preferredHits.length * 6)

  // Hard deal-breakers exclude the deal from personalised views (it stays visible in Worldwide).
  const f = deal.flight
  if (f) {
    if (prefs.maxFlightHours != null && f.durationMinutes != null && f.durationMinutes > prefs.maxFlightHours * 60) {
      exclusions.push(`Flight time ${Math.round(f.durationMinutes / 60)}h exceeds your ${prefs.maxFlightHours}h limit`)
    }
    if (prefs.dealBreakers.includes('no_connections') && (f.stops ?? 0) > 0) exclusions.push('Has connections (you want nonstop only)')
    if (
      prefs.dealBreakers.includes('no_recliner_long_haul') &&
      f.seatType === 'recliner' &&
      (f.cabin === 'business' || f.cabin === 'first') &&
      (f.durationMinutes ?? 0) >= LONG_HAUL_MINUTES
    ) {
      exclusions.push('Recliner seat on a long-haul premium flight')
    }
    if (prefs.dealBreakers.includes('no_overnight_layovers') && f.overnightLayover) exclusions.push('Includes an overnight layover')
    if (prefs.dealBreakers.includes('no_separate_tickets') && f.separateTickets) exclusions.push('Uses separate tickets')
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    excluded: exclusions.length > 0,
    reasons,
    exclusions,
  }
}

export type FeedbackSignal = 'save' | 'pass' | 'undo_save' | 'undo_pass' | 'rating' | 'booked'

/**
 * Updates learned tag weights from feedback. Small steps, clamped to [-1, 1],
 * so a single swipe never dominates explicit preferences.
 */
export function learnFromFeedback(
  weights: Readonly<Partial<Record<string, number>>>,
  tags: readonly string[],
  signal: FeedbackSignal,
  rating?: number,
): Partial<Record<string, number>> {
  const step: Record<FeedbackSignal, number> = {
    save: 0.15,
    pass: -0.08,
    undo_save: -0.15,
    undo_pass: 0.08,
    booked: 0.3,
    rating: rating != null ? (Math.max(1, Math.min(5, rating)) - 3) * 0.1 : 0,
  }
  const delta = step[signal]
  const next: Partial<Record<string, number>> = { ...weights }
  for (const tag of tags) {
    const v = (next[tag] ?? 0) + delta
    next[tag] = Math.round(Math.max(-1, Math.min(1, v)) * 1000) / 1000
  }
  return next
}
