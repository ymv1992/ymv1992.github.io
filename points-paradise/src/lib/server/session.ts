import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { getDb } from '../db/client'
import { users } from '../db/schema'
import { SESSION_COOKIE, SESSION_TTL_SECONDS, createSessionToken, verifySessionToken } from '../auth/session'

/** Verifies the session cookie and that the user still exists. Cached per request. */
export const getSessionUserId = cache(async (): Promise<string | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const payload = await verifySessionToken(token)
  if (!payload) return null
  const db = await getDb()
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, payload.uid))
  return user?.id ?? null
})

/** Use at the top of every page, route handler and server action that touches owner data. */
export async function requireUserId(): Promise<string> {
  const id = await getSessionUserId()
  if (!id) redirect('/login')
  return id
}

export async function startSession(userId: string): Promise<void> {
  const token = await createSessionToken(userId)
  ;(await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })
}

export async function endSession(): Promise<void> {
  ;(await cookies()).delete(SESSION_COOKIE)
}
