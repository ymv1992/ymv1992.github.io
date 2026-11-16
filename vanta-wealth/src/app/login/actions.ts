'use server'

import { randomBytes } from 'node:crypto'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getDb } from '@/lib/db/client'
import { hashPassword, verifyPassword } from '@/lib/auth/password'
import { loginAllowed, recordLoginAttempt } from '@/lib/auth/rate-limit'
import { ensureOwner } from '@/lib/data/store'
import { config } from '@/lib/server/config'
import { endSession, startSession } from '@/lib/server/session'

export interface LoginState {
  error: string | null
  email?: string
}

function safeNext(next: string): string {
  // Only same-site relative paths, to prevent open redirects.
  return next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/'
}

export async function login(_prev: LoginState, fd: FormData): Promise<LoginState> {
  const email = String(fd.get('email') ?? '').trim().slice(0, 200)
  const password = String(fd.get('password') ?? '').slice(0, 500)
  if (!email || !password) return { error: 'Enter your email and password.', email }
  const ownerEmail = config.ownerEmail()
  const hash = config.ownerPasswordHash()
  if (!ownerEmail || !hash) return { error: 'Sign-in is not set up yet.' }

  const h = await headers()
  const ip = (h.get('x-forwarded-for')?.split(',')[0] ?? h.get('x-real-ip') ?? 'unknown').trim().slice(0, 64)
  const db = await getDb()
  if (!(await loginAllowed(db, ip))) return { error: 'Too many failed attempts. Try again in 15 minutes.', email }

  // Always run the hash check so timing does not reveal whether the email matched.
  const passwordOk = await verifyPassword(password, hash)
  const ok = email.toLowerCase() === ownerEmail && passwordOk
  await recordLoginAttempt(db, ip, ok)
  if (!ok) return { error: 'That email and password do not match.', email }

  await startSession(await ensureOwner(db, ownerEmail))
  redirect(safeNext(String(fd.get('next') ?? '')))
}

export async function logout(): Promise<void> {
  await endSession()
  redirect('/login')
}

export interface SetupState {
  error: string | null
  hash?: string
  secret?: string
}

/**
 * First-time setup helper: turns a passphrase into the value for
 * OWNER_PASSWORD_HASH. Only available until sign-in is configured. Nothing is
 * stored; the result is shown once for the owner to paste into hosting settings.
 */
export async function generateSetupValues(_prev: SetupState, fd: FormData): Promise<SetupState> {
  if (config.ownerEmail() && config.ownerPasswordHash()) return { error: 'Sign-in is already set up.' }
  const pw = String(fd.get('passphrase') ?? '')
  if (pw.length < 12) return { error: 'Use at least 12 characters.' }
  if (pw.length > 500) return { error: 'That passphrase is too long.' }
  return { error: null, hash: await hashPassword(pw), secret: randomBytes(32).toString('base64url') }
}
