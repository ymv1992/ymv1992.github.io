/**
 * Stateless signed session tokens (HMAC-SHA256 via Web Crypto, so the same
 * code runs in the proxy and in server components). Rotating SESSION_SECRET
 * signs everyone out.
 */

export const SESSION_COOKIE = 'pp_session'
export const SESSION_TTL_SECONDS = 14 * 24 * 60 * 60

export interface SessionPayload {
  uid: string
  iat: number
  exp: number
  /** Set for a guest sign-in: the guest pass it came from (view-only access). */
  gid?: string
}

const DEV_FALLBACK_SECRET = 'dev-only-insecure-session-secret-change-me-0123456789'

export function sessionSecret(): string {
  const s = process.env.SESSION_SECRET
  if (s && s.length >= 32) return s
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET must be set to at least 32 random characters in production.')
  }
  return DEV_FALLBACK_SECRET
}

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url(s: string): Uint8Array {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : ''
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function createSessionToken(
  uid: string,
  now = Date.now(),
  secret = sessionSecret(),
  opts: { guestPassId?: string; ttlSeconds?: number } = {},
): Promise<string> {
  const iat = Math.floor(now / 1000)
  const payload: SessionPayload = { uid, iat, exp: iat + (opts.ttlSeconds ?? SESSION_TTL_SECONDS), ...(opts.guestPassId ? { gid: opts.guestPassId } : {}) }
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)))
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(body)))
  return `${body}.${b64url(sig)}`
}

export async function verifySessionToken(token: string | undefined | null, now = Date.now(), secret = sessionSecret()): Promise<SessionPayload | null> {
  if (!token) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  let ok = false
  try {
    ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromB64url(sig) as BufferSource, new TextEncoder().encode(body))
  } catch {
    return null
  }
  if (!ok) return null
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(body))) as SessionPayload
    if (typeof payload.uid !== 'string' || typeof payload.exp !== 'number') return null
    if (payload.gid !== undefined && typeof payload.gid !== 'string') return null
    if (payload.exp * 1000 < now) return null
    return payload
  } catch {
    return null
  }
}
