/** Guest passes: limited sign-ins, cancellation and password handling. */
import { beforeAll, describe, expect, it } from 'vitest'
import type { AppDb } from '@/lib/db/client'
import { ensureOwnerAccount } from '@/lib/data/account'
import { cancelGuestPass, createGuestPass, generateGuestPassword, guestPassForSession, listGuestPasses, MAX_ACTIVE_PASSES, normalizeGuestPassword, redeemGuestPassword } from '@/lib/data/guest-passes'
import { createTestDb } from '../test-db'

let db: AppDb
let userId: string

beforeAll(async () => {
  db = await createTestDb()
  userId = await ensureOwnerAccount(db, 'owner@example.com')
}, 60_000)

describe('guest passwords', () => {
  it('are 12 easy-to-read characters in three groups', () => {
    const pw = generateGuestPassword()
    expect(pw).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/)
    expect(new Set(Array.from({ length: 20 }, generateGuestPassword)).size).toBe(20)
  })
  it('accept lower case, spaces and missing dashes', () => {
    expect(normalizeGuestPassword(' k7qm 3xpa-9trd ')).toBe('K7QM-3XPA-9TRD')
  })
})

describe('guest passes', () => {
  it('sign in only as many times as allowed', async () => {
    const out = await createGuestPass(db, userId, { label: 'Sam', loginsAllowed: 3, allowSearch: false })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(await redeemGuestPassword(db, 'WRNG-PASS-WORD')).toBeNull()
    for (let i = 0; i < 3; i++) expect(await redeemGuestPassword(db, out.password.toLowerCase())).toEqual({ passId: out.id, userId })
    expect(await redeemGuestPassword(db, out.password)).toBeNull()
    const [row] = await listGuestPasses(db, userId)
    expect(row).toMatchObject({ label: 'Sam', loginsUsed: 3, loginsAllowed: 3, status: 'used_up' })
    // A used-up pass keeps the session it already opened.
    expect(await guestPassForSession(db, out.id, userId)).toMatchObject({ label: 'Sam', loginsLeft: 0, allowSearch: false })
  })

  it('cannot go past the limit when two sign-ins happen at once', async () => {
    const out = await createGuestPass(db, userId, { label: 'Race', loginsAllowed: 1, allowSearch: false })
    if (!out.ok) throw new Error(out.error)
    const results = await Promise.all([redeemGuestPassword(db, out.password), redeemGuestPassword(db, out.password)])
    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it('stop working, and end open sessions, when cancelled', async () => {
    const out = await createGuestPass(db, userId, { label: 'Alex', loginsAllowed: 3, allowSearch: true })
    if (!out.ok) throw new Error(out.error)
    expect(await redeemGuestPassword(db, out.password)).not.toBeNull()
    expect(await guestPassForSession(db, out.id, userId)).toMatchObject({ allowSearch: true, loginsLeft: 2 })
    expect(await cancelGuestPass(db, userId, out.id)).toBe(true)
    expect(await guestPassForSession(db, out.id, userId)).toBeNull()
    expect(await redeemGuestPassword(db, out.password)).toBeNull()
    expect(await cancelGuestPass(db, userId, out.id)).toBe(false)
  })

  it(`allow at most ${MAX_ACTIVE_PASSES} passes in use at once`, async () => {
    for (const p of await listGuestPasses(db, userId)) await cancelGuestPass(db, userId, p.id)
    for (let i = 0; i < MAX_ACTIVE_PASSES; i++) expect((await createGuestPass(db, userId, { label: `G${i}`, loginsAllowed: 3, allowSearch: false })).ok).toBe(true)
    expect(await createGuestPass(db, userId, { label: 'One too many', loginsAllowed: 3, allowSearch: false })).toMatchObject({ ok: false })
  })

  it('stores only a hash of the password', async () => {
    const out = await createGuestPass(db, (await ensureOwnerAccount(db, 'other@example.com')), { label: 'Hash', loginsAllowed: 1, allowSearch: false })
    if (!out.ok) throw new Error(out.error)
    const { guestPasses } = await import('@/lib/db/schema')
    const rows = await db.select().from(guestPasses)
    expect(rows.every((r) => !r.passwordHash.includes(out.password) && r.passwordHash.startsWith('scrypt:'))).toBe(true)
  })
})
