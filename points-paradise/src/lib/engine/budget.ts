export interface TripBudget {
  pointsBalance: number
  maxCashUsd: number
}

export interface BudgetCheck {
  withinPoints: boolean
  withinCash: boolean
  ok: boolean
  pointsShortfall: number
  cashOverageUsd: number
  pointsRemaining: number
  cashRemainingUsd: number
}

export function checkBudget(cost: { chasePoints: number; cashUsd: number }, budget: TripBudget): BudgetCheck {
  const pointsShortfall = Math.max(0, cost.chasePoints - budget.pointsBalance)
  const cashOverageUsd = Math.max(0, cost.cashUsd - budget.maxCashUsd)
  return {
    withinPoints: pointsShortfall === 0,
    withinCash: cashOverageUsd === 0,
    ok: pointsShortfall === 0 && cashOverageUsd === 0,
    pointsShortfall,
    cashOverageUsd,
    pointsRemaining: Math.max(0, budget.pointsBalance - cost.chasePoints),
    cashRemainingUsd: Math.max(0, budget.maxCashUsd - cost.cashUsd),
  }
}

export interface ApiSpendDecision {
  allowed: boolean
  reason: string
  projectedUsd: number
}

/**
 * Gate for optional paid requests. Pauses before the monthly cap would be
 * exceeded, keeping a small reserve so in-flight work cannot overshoot it.
 */
export function canSpend(monthSpentUsd: number, plannedCostUsd: number, monthlyCapUsd: number, reserveFraction = 0.05): ApiSpendDecision {
  const projected = monthSpentUsd + plannedCostUsd
  if (plannedCostUsd <= 0) return { allowed: true, reason: 'Free request', projectedUsd: monthSpentUsd }
  if (monthlyCapUsd <= 0) return { allowed: false, reason: 'Paid requests are disabled (monthly cap is $0).', projectedUsd: monthSpentUsd }
  const limit = monthlyCapUsd * (1 - reserveFraction)
  if (projected > limit) {
    return {
      allowed: false,
      reason: `Paused: this request would bring monthly spend to $${projected.toFixed(2)}, above ${Math.round((1 - reserveFraction) * 100)}% of your $${monthlyCapUsd.toFixed(2)} cap.`,
      projectedUsd: monthSpentUsd,
    }
  }
  return { allowed: true, reason: 'Within budget', projectedUsd: projected }
}

/** Per-provider quota gate (e.g. 1,000 calls/day or N searches/month). */
export function withinQuota(used: number, planned: number, quota: number | null): boolean {
  if (quota == null) return true
  return used + planned <= quota
}
