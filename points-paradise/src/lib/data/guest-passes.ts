import { randomInt } from 'node:crypto'
import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm'
import type { AppDb } from '../db/client'
import { guestPasses } from '../db/schema'
import { hashPassword, verifyPassword } from '../auth/password'

/** How long one guest sign-in lasts. */
export const GUEST_SESSION_HOURS = 24
/** Passes that can still be used at the same time; keeps sign-in checks quick. */
export const MAX_ACTIVE_PASSES = 3
export const MAX_GUEST_LOGINS = 10

// No 0/O, 1/I/L, so the password is easy to read out or type from a text message.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/** 12 random characters in three groups, e.g. "K7QM-3XPA-9TRD" (about 59 bits). */
export function generateGuestPassword(): string {
  const chars = Array.from({ length: 12 }, () => ALPHABET[randomInt(ALPHABET.length)]!)
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8)].map((g) => g.join('')).join('-')
}

/** Accepts the password typed in lower case, with spaces or without the dashes. */
export function normalizeGuestPassword(input: string): string {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return raw.length === 12 ? `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}` : raw
}

export type GuestPassStatus = 'active' | 'used_up' | 'cancelled'

export interface GuestPassRow {
  id: string
  label: string
  loginsAllowed: number
  loginsUsed: number
  allowSearch: boolean
  createdAt: Date
  lastUsedAt: Date | null
  status: GuestPassStatus
}

function statusOf(p: { loginsUsed: number; loginsAllowed: number; revokedAt: Date | null }): GuestPassStatus {
  if (p.revokedAt) return 'cancelled'
  return p.loginsUsed >= p.loginsAllowed ? 'used_up' : 'active'
}

const activeWhere = (userId?: string) =>
  and(isNull(guestPasses.revokedAt), lt(guestPasses.loginsUsed, guestPasses.loginsAllowed), userId ? eq(guestPasses.userId, userId) : undefined)

export async function listGuestPasses(db: AppDb, userId: string): Promise<GuestPassRow[]> {
  const rows = await db.select().from(guestPasses).where(eq(guestPasses.userId, userId)).orderBy(desc(guestPasses.createdAt))
  return rows.map((p) => ({
    id: p.id,
    label: p.label,
    loginsAllowed: p.loginsAllowed,
    loginsUsed: p.loginsUsed,
    allowSearch: p.allowSearch,
    createdAt: p.createdAt,
    lastUsedAt: p.lastUsedAt,
    status: statusOf(p),
  }))
}

/** Creates a pass and returns its password, which is only ever shown this once. */
export async function createGuestPass(
  db: AppDb,
  userId: string,
  input: { label: string; loginsAllowed: number; allowSearch: boolean },
): Promise<{ ok: true; id: string; password: string } | { ok: false; error: string }> {
  const active = await db.select({ id: guestPasses.id }).from(guestPasses).where(activeWhere(userId))
  if (active.length >= MAX_ACTIVE_PASSES) return { ok: false, error: `You already have ${MAX_ACTIVE_PASSES} guest passes in use. Cancel one first.` }
  const password = generateGuestPassword()
  const [row] = await db
    .insert(guestPasses)
    .values({ userId, label: input.label, loginsAllowed: input.loginsAllowed, allowSearch: input.allowSearch, passwordHash: await hashPassword(password) })
    .returning({ id: guestPasses.id })
  return { ok: true, id: row!.id, password }
}

export async function cancelGuestPass(db: AppDb, userId: string, id: string, now = new Date()): Promise<boolean> {
  const rows = await db
    .update(guestPasses)
    .set({ revokedAt: now })
    .where(and(eq(guestPasses.id, id), eq(guestPasses.userId, userId), isNull(guestPasses.revokedAt)))
    .returning({ id: guestPasses.id })
  return rows.length > 0
}

/**
 * Checks a guest password against the passes still in use and, on a match,
 * counts one sign-in. The count is taken in a single conditional update, so
 * two sign-ins at once cannot go past the limit.
 */
export async function redeemGuestPassword(db: AppDb, input: string, now = new Date()): Promise<{ passId: string; userId: string } | null> {
  const password = normalizeGuestPassword(input)
  const active = await db.select().from(guestPasses).where(activeWhere())
  for (const pass of active) {
    if (!(await verifyPassword(password, pass.passwordHash))) continue
    const [used] = await db
      .update(guestPasses)
      .set({ loginsUsed: sql`${guestPasses.loginsUsed} + 1`, lastUsedAt: now })
      .where(and(eq(guestPasses.id, pass.id), activeWhere()))
      .returning({ id: guestPasses.id, userId: guestPasses.userId })
    return used ? { passId: used.id, userId: used.userId } : null
  }
  return null
}

/** The pass behind a guest session, or null once the owner has cancelled it. Used-up passes keep their open session. */
export async function guestPassForSession(db: AppDb, passId: string, userId: string) {
  const [pass] = await db
    .select()
    .from(guestPasses)
    .where(and(eq(guestPasses.id, passId), eq(guestPasses.userId, userId), isNull(guestPasses.revokedAt)))
  return pass ? { passId: pass.id, label: pass.label, allowSearch: pass.allowSearch, loginsLeft: Math.max(0, pass.loginsAllowed - pass.loginsUsed) } : null
}
