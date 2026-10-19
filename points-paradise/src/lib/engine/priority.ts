/**
 * Search priority queue. Decides which permitted checks to run next within
 * the request and spending budget, instead of scanning the world continuously.
 */

export const QUEUE_KINDS = [
  'user_request',
  'deadline',
  'saved_deal',
  'watchlist',
  'promotion',
  'saved_route',
  'historical_route',
  'low_interest',
] as const
export type QueueKind = (typeof QUEUE_KINDS)[number]

const BASE_PRIORITY: Record<QueueKind, number> = {
  user_request: 100,
  deadline: 80,
  saved_deal: 70,
  watchlist: 60,
  promotion: 55,
  saved_route: 50,
  historical_route: 30,
  low_interest: 10,
}

export interface QueueCandidate {
  key: string
  kind: QueueKind
  provider: string
  lastCheckedAt: Date | null
  refreshHours: number
  /** Consecutive checks that found no change. */
  unchangedStreak: number
  estimatedCostUsd: number
  /** Optional: hours until a confirmed deadline. */
  hoursToDeadline?: number | null
  /** Recent price movement observed (any direction) boosts priority. */
  recentlyChanged?: boolean
}

export function isDue(c: QueueCandidate, now: Date): boolean {
  if (c.kind === 'user_request') return true
  if (!c.lastCheckedAt) return true
  // Back off unchanged results: each unchanged check stretches the interval up to 4×.
  const backoff = 1 + Math.min(3, c.unchangedStreak * 0.5)
  return now.getTime() - c.lastCheckedAt.getTime() >= c.refreshHours * backoff * 3_600_000
}

export function priorityScore(c: QueueCandidate, now: Date): number {
  let score = BASE_PRIORITY[c.kind]
  if (c.hoursToDeadline != null && c.hoursToDeadline >= 0 && c.hoursToDeadline <= 72) score += 20 * (1 - c.hoursToDeadline / 72)
  if (c.recentlyChanged) score += 10
  if (c.lastCheckedAt) {
    const overdue = (now.getTime() - c.lastCheckedAt.getTime()) / 3_600_000 / Math.max(1, c.refreshHours)
    score += Math.min(15, Math.max(0, (overdue - 1) * 5))
  } else score += 10
  score -= Math.min(25, c.unchangedStreak * 5)
  score -= Math.min(20, c.estimatedCostUsd * 100)
  return Math.round(score * 100) / 100
}

export interface BatchPlan {
  selected: QueueCandidate[]
  skippedBudget: QueueCandidate[]
  notDue: QueueCandidate[]
}

/** Picks the highest-priority due checks that fit within the request and cost budgets. */
export function planBatch(
  candidates: readonly QueueCandidate[],
  now: Date,
  limits: { maxRequests: number; budgetRemainingUsd: number; perProviderRemaining?: Readonly<Record<string, number>> },
): BatchPlan {
  const seen = new Set<string>()
  const due: QueueCandidate[] = []
  const notDue: QueueCandidate[] = []
  for (const c of candidates) {
    if (seen.has(c.key)) continue
    seen.add(c.key)
    if (isDue(c, now)) due.push(c)
    else notDue.push(c)
  }
  due.sort((a, b) => priorityScore(b, now) - priorityScore(a, now) || a.key.localeCompare(b.key))
  const selected: QueueCandidate[] = []
  const skippedBudget: QueueCandidate[] = []
  let spent = 0
  const providerUse: Record<string, number> = {}
  for (const c of due) {
    const providerLeft = limits.perProviderRemaining?.[c.provider]
    const used = providerUse[c.provider] ?? 0
    if (
      selected.length >= limits.maxRequests ||
      spent + c.estimatedCostUsd > limits.budgetRemainingUsd + 1e-9 ||
      (providerLeft != null && used + 1 > providerLeft)
    ) {
      skippedBudget.push(c)
      continue
    }
    selected.push(c)
    spent += c.estimatedCostUsd
    providerUse[c.provider] = used + 1
  }
  return { selected, skippedBudget, notDue }
}
