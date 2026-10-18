'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { verifyPassword } from '@/lib/auth/password'
import { loginAllowed, recordLoginAttempt } from '@/lib/auth/rate-limit'
import { ensureOwnerAccount, loadAccount } from '@/lib/data/account'
import { config } from '@/lib/server/config'
import { endSession, startSession } from '@/lib/server/session'

export interface LoginState {
  error: string | null
  /** Echoed back so the field is not cleared when React resets the form after a failed attempt. */
  email?: string
}

const schema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(1).max(500),
  next: z.string().max(500).optional(),
})

function safeNext(next: string | undefined): string | null {
  // Only allow same-site relative paths to prevent open redirects.
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null
  return next
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = schema.safeParse(Object.fromEntries(formData))
  const email = String(formData.get('email') ?? '').slice(0, 200)
  if (!parsed.success) return { error: 'Enter your email and password.', email }
  const ownerEmail = config.ownerEmail()
  const hash = config.ownerPasswordHash()
  if (!ownerEmail || !hash) return { error: 'Sign-in is not configured. Set OWNER_EMAIL and OWNER_PASSWORD_HASH.' }

  const h = await headers()
  const ip = (h.get('x-forwarded-for')?.split(',')[0] ?? h.get('x-real-ip') ?? 'unknown').trim().slice(0, 64)
  const db = await getDb()
  if (!(await loginAllowed(db, ip))) return { error: 'Too many failed attempts. Try again in 15 minutes.', email }

  const emailOk = parsed.data.email.toLowerCase() === ownerEmail
  // Always run the hash check so timing does not reveal whether the email matched.
  const passwordOk = await verifyPassword(parsed.data.password, hash)
  const ok = emailOk && passwordOk
  await recordLoginAttempt(db, ip, ok)
  if (!ok) return { error: 'That email and password do not match.', email }

  const userId = await ensureOwnerAccount(db, ownerEmail)
  await startSession(userId)
  const account = await loadAccount(db, userId)
  redirect(account.settings.onboardingCompletedAt ? (safeNext(parsed.data.next) ?? '/discover') : '/onboarding')
}

export async function logout(): Promise<void> {
  await endSession()
  redirect('/login')
}
