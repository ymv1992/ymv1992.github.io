import { and, eq, gte, sql } from 'drizzle-orm'
import type { AppDb } from '../db/client'
import { authAttempts } from '../db/schema'

export const LOGIN_WINDOW_MINUTES = 15
export const MAX_FAILURES_PER_IP = 8
export const MAX_FAILURES_GLOBAL = 40

/** Blocks brute force: per-IP and global failure caps within a sliding window. */
export async function loginAllowed(db: AppDb, ip: string, now = new Date()): Promise<boolean> {
  const since = new Date(now.getTime() - LOGIN_WINDOW_MINUTES * 60_000)
  const [perIp] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(authAttempts)
    .where(and(eq(authAttempts.ip, ip), eq(authAttempts.success, false), gte(authAttempts.createdAt, since)))
  const [global] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(authAttempts)
    .where(and(eq(authAttempts.success, false), gte(authAttempts.createdAt, since)))
  return (perIp?.n ?? 0) < MAX_FAILURES_PER_IP && (global?.n ?? 0) < MAX_FAILURES_GLOBAL
}

export async function recordLoginAttempt(db: AppDb, ip: string, success: boolean): Promise<void> {
  await db.insert(authAttempts).values({ ip, success })
  // Keep the table small.
  await db.delete(authAttempts).where(sql`${authAttempts.createdAt} < now() - interval '7 days'`)
}
