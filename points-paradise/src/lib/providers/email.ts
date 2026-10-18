import 'server-only'
import { config } from '../server/config'

/**
 * Sends a plain-text email through Resend's REST API. Returns ok:false (never
 * throws) so a delivery failure never blocks the in-app notification.
 */
export async function sendEmail(to: string, subject: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const key = config.resendKey()
  const from = config.emailFrom()
  if (!key || !from) return { ok: false, error: 'Email is not configured (RESEND_API_KEY and EMAIL_FROM).' }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject: subject.slice(0, 200), text: text.slice(0, 20_000) }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return { ok: false, error: `Resend responded ${res.status}` }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Email request failed' }
  }
}
