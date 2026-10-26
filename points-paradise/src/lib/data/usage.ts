import { and, desc, eq, gte, sql } from 'drizzle-orm'
import type { AppDb } from '../db/client'
import { dataSources, searchJobs } from '../db/schema'

export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

export function dayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

export async function monthSpendUsd(db: AppDb, now = new Date(), provider?: string): Promise<number> {
  const [r] = await db
    .select({ total: sql<number>`coalesce(sum(${searchJobs.estimatedCostUsd}), 0)::float8` })
    .from(searchJobs)
    .where(and(gte(searchJobs.createdAt, monthStart(now)), provider ? eq(searchJobs.provider, provider) : sql`true`))
  return Number(r?.total ?? 0)
}

export async function requestsSince(db: AppDb, provider: string, since: Date, jobType?: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`coalesce(sum(${searchJobs.requestCount}), 0)::int` })
    .from(searchJobs)
    .where(and(eq(searchJobs.provider, provider), gte(searchJobs.createdAt, since), jobType ? eq(searchJobs.jobType, jobType) : sql`true`))
  return Number(r?.n ?? 0)
}

export interface JobRecord {
  provider: string
  jobType: string
  params?: Record<string, unknown>
  status: 'succeeded' | 'failed' | 'skipped_budget' | 'skipped_unconfigured' | 'skipped_quota'
  startedAt: Date
  finishedAt?: Date
  requestCount?: number
  estimatedCostUsd?: number
  resultsCount?: number
  error?: string | null
  priority?: number | null
}

export async function logJob(db: AppDb, j: JobRecord): Promise<void> {
  const finished = j.finishedAt ?? new Date()
  await db.insert(searchJobs).values({
    provider: j.provider,
    jobType: j.jobType,
    params: j.params ?? {},
    status: j.status,
    priority: j.priority ?? null,
    startedAt: j.startedAt,
    finishedAt: finished,
    durationMs: Math.max(0, finished.getTime() - j.startedAt.getTime()),
    requestCount: j.requestCount ?? 0,
    estimatedCostUsd: j.estimatedCostUsd ?? 0,
    resultsCount: j.resultsCount ?? 0,
    error: j.error ? j.error.slice(0, 1000) : null,
    createdAt: j.startedAt,
  })
  if (j.status === 'succeeded') {
    await db.update(dataSources).set({ healthStatus: 'ok', lastSuccessAt: finished, updatedAt: finished }).where(eq(dataSources.id, j.provider))
  } else if (j.status === 'failed') {
    await db
      .update(dataSources)
      .set({ healthStatus: 'failing', lastErrorAt: finished, lastError: (j.error ?? 'Unknown error').slice(0, 500), updatedAt: finished })
      .where(eq(dataSources.id, j.provider))
  }
}

export async function usageSummary(db: AppDb, now = new Date()) {
  const since = monthStart(now)
  const byProvider = await db
    .select({
      provider: searchJobs.provider,
      jobs: sql<number>`count(*)::int`,
      requests: sql<number>`coalesce(sum(${searchJobs.requestCount}), 0)::int`,
      cost: sql<number>`coalesce(sum(${searchJobs.estimatedCostUsd}), 0)::float8`,
      failed: sql<number>`count(*) filter (where ${searchJobs.status} = 'failed')::int`,
      skipped: sql<number>`count(*) filter (where ${searchJobs.status} like 'skipped%')::int`,
    })
    .from(searchJobs)
    .where(gte(searchJobs.createdAt, since))
    .groupBy(searchJobs.provider)
  const recent = await db.select().from(searchJobs).orderBy(desc(searchJobs.createdAt)).limit(50)
  const sources = await db.select().from(dataSources)
  return { since, byProvider, recent, sources }
}
