import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { getDb } from '../db/client'
import { users } from '../db/schema'
import { guestPassForSession } from '../data/guest-passes'
import { SESSION_COOKIE, SESSION_TTL_SECONDS, createSessionToken, verifySessionToken } from '../auth/session'

export interface GuestView {
  passId: string
  label: string
  allowSearch: boolean
  loginsLeft: number
}

/** Who is signed in: the owner, or a guest looking at the owner's data through a guest pass. */
export interface Viewer {
  userId: string
  guest: GuestView | null
}

/** Verifies the session cookie, that the user still exists and, for guests, that the pass is not cancelled. Cached per request. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const payload = await verifySessionToken(token)
  if (!payload) return null
  const db = await getDb()
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, payload.uid))
  if (!user) return null
  if (!payload.gid) return { userId: user.id, guest: null }
  const guest = await guestPassForSession(db, payload.gid, user.id)
  return guest ? { userId: user.id, guest } : null
})

export async function getSessionUserId(): Promise<string | null> {
  return (await getViewer())?.userId ?? null
}

/** For pages and loaders that only read: the owner or a guest. */
export async function requireViewerId(): Promise<string> {
  const viewer = await getViewer()
  if (!viewer) redirect('/login')
  return viewer.userId
}

/**
 * Use at the top of every server action, route handler and owner-only page.
 * Guests are sent to the view-only notice, except for award and hotel
 * searches when their pass allows them (`guestMay: 'search'`).
 */
export async function requireUserId(opts: { guestMay?: 'search' } = {}): Promise<string> {
  const viewer = await getViewer()
  if (!viewer) redirect('/login')
  if (viewer.guest && !(opts.guestMay === 'search' && viewer.guest.allowSearch)) redirect('/view-only')
  return viewer.userId
}

export async function startSession(userId: string, opts: { guestPassId?: string; ttlSeconds?: number } = {}): Promise<void> {
  const ttlSeconds = opts.ttlSeconds ?? SESSION_TTL_SECONDS
  const token = await createSessionToken(userId, Date.now(), undefined, { guestPassId: opts.guestPassId, ttlSeconds })
  ;(await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: ttlSeconds,
  })
}

export async function endSession(): Promise<void> {
  ;(await cookies()).delete(SESSION_COOKIE)
}
