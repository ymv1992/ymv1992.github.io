'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { loadAccount, DEFAULT_ALERT_PREFS } from '@/lib/data/account'
import { notify, toAlertPreferences } from '@/lib/data/notifications'
import { createPromotion, deletePromotion, partnerUpdateSchema, promotionInputSchema, updatePartner, verifyPromotion } from '@/lib/data/transfers'
import { CARD_TYPE_IDS } from '@/lib/domain/constants'
import { sendEmail } from '@/lib/providers/email'
import { isValidTimeZone, zonedWallTimeToDate } from '@/lib/time'
import { config } from '@/lib/server/config'
import { requireUserId } from '@/lib/server/session'

export interface FormState {
  error: string | null
  ok?: string
}

export async function createPromotionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId()
  const raw = Object.fromEntries(formData)
  // datetime-local values are wall-clock times in the promotion's own time zone (e.g. 11:59 PM ET).
  const tz = String(raw.endsAtTimezone || 'America/New_York')
  if (!isValidTimeZone(tz)) return { error: `Unknown time zone "${tz}" — use an IANA name like America/New_York` }
  const startsAt = raw.startsAt ? zonedWallTimeToDate(String(raw.startsAt), tz) : null
  const endsAt = raw.endsAt ? zonedWallTimeToDate(String(raw.endsAt), tz) : null
  if (raw.startsAt && !startsAt) return { error: 'Invalid start time' }
  if (raw.endsAt && !endsAt) return { error: 'Invalid end time' }
  const parsed = promotionInputSchema.safeParse({ ...raw, startsAt, endsAt, endsAtTimezone: tz, eligibleCardTypes: formData.getAll('eligibleCardTypes') })
  if (!parsed.success) {
    const i = parsed.error.issues[0]
    return { error: i ? `${i.path.join('.')}: ${i.message}` : 'Check the form' }
  }
  const db = await getDb()
  try {
    const id = await createPromotion(db, parsed.data)
    const account = await loadAccount(db, userId)
    await notify(
      db,
      userId,
      {
        type: 'transfer_bonus_new',
        promotionId: id,
        discriminator: String(parsed.data.bonusPercent),
        title: `${parsed.data.bonusPercent}% transfer bonus recorded`,
        body: `A ${parsed.data.bonusPercent}% bonus to ${parsed.data.partnerId.replace(/_/g, ' ')} was added${parsed.data.endsAt ? `, ending ${parsed.data.endsAt.toISOString().slice(0, 10)}` : ''}.`,
        link: '/transfers',
      },
      {
        prefs: toAlertPreferences(account.settings.alertPrefs ?? DEFAULT_ALERT_PREFS, account.settings.timezone),
        emailEnabled: account.settings.emailEnabled,
        emailTo: account.settings.notificationEmail,
        sendEmail,
        appUrl: config.appUrl(),
      },
    )
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not save' }
  }
  revalidatePath('/transfers')
  return { error: null, ok: 'Promotion saved. Deal values were recalculated with it.' }
}

export async function deletePromotionAction(id: string): Promise<void> {
  await requireUserId()
  if (!z.string().uuid().safeParse(id).success) return
  await deletePromotion(await getDb(), id)
  revalidatePath('/transfers')
}

export async function verifyPromotionAction(id: string): Promise<void> {
  await requireUserId()
  if (!z.string().uuid().safeParse(id).success) return
  await verifyPromotion(await getDb(), id)
  revalidatePath('/transfers')
}

export async function updatePartnerAction(partnerId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireUserId()
  if (!z.string().regex(/^[a-z_]{2,40}$/).safeParse(partnerId).success) return { error: 'Invalid partner' }
  const overrides: Record<string, { chase: string; partner: string }> = {}
  for (const card of CARD_TYPE_IDS) {
    const c = formData.get(`override_${card}_chase`)
    const p = formData.get(`override_${card}_partner`)
    if (c && p) overrides[card] = { chase: String(c), partner: String(p) }
  }
  const parsed = partnerUpdateSchema.safeParse({
    baseRatio: { chase: formData.get('baseChase'), partner: formData.get('basePartner') },
    cardRatioOverrides: overrides,
    minTransfer: formData.get('minTransfer'),
    transferIncrement: formData.get('transferIncrement'),
    processingTime: formData.get('processingTime'),
    typicalValueCents: formData.get('typicalValueCents'),
    active: formData.get('active'),
    notes: formData.get('notes'),
    markVerified: formData.get('markVerified'),
  })
  if (!parsed.success) {
    const i = parsed.error.issues[0]
    return { error: i ? `${i.path.join('.')}: ${i.message}` : 'Check the form' }
  }
  await updatePartner(await getDb(), partnerId, parsed.data)
  revalidatePath('/transfers')
  return { error: null, ok: parsed.data.markVerified ? 'Saved and marked as verified by you today.' : 'Saved.' }
}
