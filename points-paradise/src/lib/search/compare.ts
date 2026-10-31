/**
 * Helpers for showing award search results (safe to use in the browser):
 * cabin comparisons, seat counts and transfer bonus notes.
 */
import type { AwardSearchResultRow, CabinCompareRow, TransferBonusFlag } from '../data/award-search'
import { CABINS, CABIN_LABELS, type Cabin } from '../domain/constants'

/** What an option costs in Chase points, or in program points when that is unknown. */
export function optionCost(r: Pick<AwardSearchResultRow, 'chasePoints' | 'points'>): number {
  return r.chasePoints ?? r.points
}

const n = (v: number) => Math.round(v).toLocaleString('en-US')

/**
 * How much more a better cabin costs than economy on the same date, e.g.
 * "Business is only 12,500 more points than Economy". Null without economy
 * or a better cabin to compare it with.
 */
export function upgradeNote(cells: CabinCompareRow['cells']): string | null {
  const economy = cells.economy
  if (!economy) return null
  const base = optionCost(economy)
  const cabin = (['business', 'first', 'premium_economy'] as const).find((c) => cells[c])
  if (!cabin || base <= 0) return null
  const cost = optionCost(cells[cabin]!)
  const label = CABIN_LABELS[cabin]
  if (cost <= base) return `${label} costs no more points than Economy here.`
  const extra = cost - base
  if (cost / base <= 1.5) return `${label} is only ${n(extra)} more points than Economy.`
  return `${label} is ${n(extra)} more points than Economy (${(cost / base).toFixed(1)}×).`
}

/** Cabins that appear in any row, in cabin order. */
export function cabinsIn(rows: readonly CabinCompareRow[]): Cabin[] {
  return CABINS.filter((c) => rows.some((r) => r.cells[c]))
}

/** The lowest cost in each cabin across the rows, to highlight the best date per cabin. */
export function lowestByCabin(rows: readonly CabinCompareRow[]): Partial<Record<Cabin, number>> {
  const out: Partial<Record<Cabin, number>> = {}
  for (const r of rows) {
    for (const c of CABINS) {
      const cell = r.cells[c]
      if (!cell) continue
      const cost = optionCost(cell)
      if (out[c] == null || cost < out[c]!) out[c] = cost
    }
  }
  return out
}

/** "2 seats left"; when more than one seat is needed and the count is unknown, a reminder to check. */
export function seatsLabel(seats: number | null, needed: number): string | null {
  if (seats != null) return `${seats} seat${seats === 1 ? '' : 's'} left`
  return needed > 1 ? 'seats not reported — check before transferring' : null
}

export interface BonusNote {
  partnerName: string
  percent: number
  text: string
}

/** The day a bonus ends where its deadline is set (Chase bonuses usually end 11:59 PM Eastern). */
function shortDay(iso: string, timeZone: string | null): string {
  const opts = { month: 'short', day: 'numeric', year: 'numeric' } as const
  try {
    return new Date(iso).toLocaleDateString('en-US', { ...opts, timeZone: timeZone ?? 'America/New_York' })
  } catch {
    return new Date(iso).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' })
  }
}

const VERIFICATION: Record<TransferBonusFlag['verification'], string> = {
  official_verified: 'confirmed on Chase’s site',
  owner_verified: 'you confirmed it',
  reported: 'reported — confirm it in your Chase account before transferring',
}

/** One plain sentence per transfer bonus that applies to the results. */
export function bonusNotes(rows: readonly AwardSearchResultRow[]): BonusNote[] {
  const seen = new Map<string, BonusNote>()
  for (const r of rows) {
    const b = r.bonus
    if (!b || seen.has(b.partnerName)) continue
    const until = b.endsAt ? ` until ${shortDay(b.endsAt, b.endsAtTimezone)}` : ''
    seen.set(b.partnerName, {
      partnerName: b.partnerName,
      percent: b.percent,
      text: `Chase is adding ${b.percent}% when you transfer to ${b.partnerName}${until} (${VERIFICATION[b.verification]}). Chase points shown for ${b.partnerName} awards already include it.`,
    })
  }
  return [...seen.values()]
}
