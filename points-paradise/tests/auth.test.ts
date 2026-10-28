import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '@/lib/auth/password'
import { createSessionToken, verifySessionToken } from '@/lib/auth/session'

const SECRET = 'test-secret-test-secret-test-secret-123'

describe('password hashing', () => {
  it('verifies the right password only', async () => {
    const h = await hashPassword('correct horse battery staple')
    expect(h.startsWith('scrypt:')).toBe(true)
    expect(h).not.toContain('$')
    expect(await verifyPassword('correct horse battery staple', h)).toBe(true)
    expect(await verifyPassword('wrong', h)).toBe(false)
    expect(await verifyPassword('x', 'garbage')).toBe(false)
  })
})

describe('session tokens', () => {
  it('round-trips and rejects tampering, wrong secrets and expiry', async () => {
    const now = Date.now()
    const t = await createSessionToken('user-1', now, SECRET)
    expect((await verifySessionToken(t, now, SECRET))?.uid).toBe('user-1')
    expect(await verifySessionToken(t, now, 'another-secret-another-secret-12345')).toBeNull()
    const [body, sig] = t.split('.')
    const forged = Buffer.from(JSON.stringify({ uid: 'admin', iat: 0, exp: 9e9 })).toString('base64url')
    expect(await verifySessionToken(`${forged}.${sig}`, now, SECRET)).toBeNull()
    expect(await verifySessionToken(`${body}.`, now, SECRET)).toBeNull()
    expect(await verifySessionToken(t, now + 15 * 86_400_000, SECRET)).toBeNull()
    expect(await verifySessionToken(undefined, now, SECRET)).toBeNull()
  })

  it('carries the guest pass and a shorter lifetime for guest sign-ins', async () => {
    const now = Date.now()
    const t = await createSessionToken('user-1', now, SECRET, { guestPassId: 'pass-1', ttlSeconds: 24 * 3600 })
    expect(await verifySessionToken(t, now, SECRET)).toMatchObject({ uid: 'user-1', gid: 'pass-1' })
    expect(await verifySessionToken(t, now + 25 * 3_600_000, SECRET)).toBeNull()
    // The owner's token has no guest pass, and a guest cannot strip it without breaking the signature.
    expect((await verifySessionToken(await createSessionToken('user-1', now, SECRET), now, SECRET))?.gid).toBeUndefined()
    const [, sig] = t.split('.')
    const stripped = Buffer.from(JSON.stringify({ uid: 'user-1', iat: 0, exp: 9e9 })).toString('base64url')
    expect(await verifySessionToken(`${stripped}.${sig}`, now, SECRET)).toBeNull()
  })
})
