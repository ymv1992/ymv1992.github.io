/**
 * Reads the place name and position out of a Google Maps link, without
 * calling Google: the information is in the link itself. Short share links
 * (maps.app.goo.gl) only need their redirect followed.
 */

export interface MapsLinkInfo {
  name: string | null
  lat: number | null
  lng: number | null
}

const GOOGLE_HOST = /^(?:www\.|maps\.)?google\.(?:com|[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2})$/i
const SHORT_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl'])

function parse(url: string): URL | null {
  try {
    const u = new URL(url.trim())
    return u.protocol === 'https:' || u.protocol === 'http:' ? u : null
  } catch {
    return null
  }
}

/** maps.app.goo.gl/… or goo.gl/maps/… share links, which redirect to the full link. */
export function isShortMapsLink(url: string | null | undefined): boolean {
  const u = url ? parse(url) : null
  if (!u || !SHORT_HOSTS.has(u.hostname.toLowerCase())) return false
  return u.hostname.toLowerCase() === 'maps.app.goo.gl' || u.pathname.startsWith('/maps/')
}

export function isGoogleMapsLink(url: string | null | undefined): boolean {
  const u = url ? parse(url) : null
  if (!u) return false
  if (isShortMapsLink(url)) return true
  const host = u.hostname.toLowerCase()
  if (!GOOGLE_HOST.test(host)) return false
  return host.startsWith('maps.') || u.pathname.startsWith('/maps')
}

function coords(lat: number, lng: number): { lat: number; lng: number } | null {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0) ? { lat, lng } : null
}

const LATLNG = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/

function decodeName(raw: string): string | null {
  let name = raw
  try {
    name = decodeURIComponent(raw.replace(/\+/g, ' '))
  } catch {
    name = raw.replace(/\+/g, ' ')
  }
  name = name.replace(/\s+/g, ' ').trim()
  return name && !LATLNG.test(name) ? name.slice(0, 200) : null
}

/** Name and position from a full Google Maps link; null for anything else. */
export function parseGoogleMapsLink(url: string): MapsLinkInfo | null {
  const u = parse(url)
  if (!u || !isGoogleMapsLink(url) || isShortMapsLink(url)) return null
  let name: string | null = null
  let point: { lat: number; lng: number } | null = null

  // /maps/place/<name>/@lat,lng,zoom/data=…!3d<lat>!4d<lng>  (the !3d/!4d pair is the place itself; @ is the map view)
  const placeMatch = u.pathname.match(/\/maps\/(?:place|search|dir\/[^/]*)\/([^/@]+)/)
  if (placeMatch) name = decodeName(placeMatch[1]!)
  let full = u.pathname + u.search
  try {
    full = decodeURIComponent(full)
  } catch {
    // Keep the raw text when the link has a broken escape.
  }
  const pin = full.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/)
  if (pin) point = coords(Number(pin[1]), Number(pin[2]))
  if (!point) {
    const at = u.pathname.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/)
    if (at) point = coords(Number(at[1]), Number(at[2]))
  }
  // ?q=…, ?query=… (api=1 links), ?ll=lat,lng, ?center=lat,lng
  for (const key of ['q', 'query', 'destination', 'll', 'center']) {
    const v = u.searchParams.get(key)
    if (!v) continue
    const m = v.match(LATLNG)
    if (m) point ??= coords(Number(m[1]), Number(m[2]))
    else if (key !== 'll' && key !== 'center') name ??= decodeName(v)
  }
  if (!name && !point) return null
  return { name, lat: point?.lat ?? null, lng: point?.lng ?? null }
}

/**
 * Follows a short share link's redirects (at most 3, Google hosts only) to the
 * full link. Only the redirect address is read; nothing from the page itself.
 */
export async function expandShortMapsLink(url: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  let current = url
  for (let hop = 0; hop < 3; hop++) {
    if (!isShortMapsLink(current) && isGoogleMapsLink(current)) return current
    const res = await fetchImpl(current, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(6000) })
    const next = res.headers.get('location')
    if (res.status < 300 || res.status >= 400 || !next) return null
    const resolved = new URL(next, current).toString()
    if (!isGoogleMapsLink(resolved) && !isShortMapsLink(resolved)) return null
    current = resolved
  }
  return isGoogleMapsLink(current) && !isShortMapsLink(current) ? current : null
}
