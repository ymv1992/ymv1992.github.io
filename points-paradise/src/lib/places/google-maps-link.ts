/**
 * Reads the place name and position out of Google links, without calling a
 * Google API: the information is in the link itself. Short share links
 * (maps.app.goo.gl, share.google, g.co/kgs) only need their redirect followed.
 */

export interface MapsLinkInfo {
  name: string | null
  lat: number | null
  lng: number | null
}

const GOOGLE_HOST = /^(?:www\.|maps\.)?google\.(?:com|[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2})$/i
const CONSENT_HOST = /^consent\.google\.(?:com|[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2})$/i

function parse(url: string): URL | null {
  try {
    const u = new URL(url.trim())
    return u.protocol === 'https:' || u.protocol === 'http:' ? u : null
  } catch {
    return null
  }
}

/** maps.app.goo.gl/… or goo.gl/maps/… share links, which redirect to a full Google Maps link. */
export function isShortMapsLink(url: string | null | undefined): boolean {
  const u = url ? parse(url) : null
  if (!u) return false
  const host = u.hostname.toLowerCase()
  return host === 'maps.app.goo.gl' || (host === 'goo.gl' && u.pathname.startsWith('/maps/'))
}

/**
 * Any short Google share link: Maps share links, plus share.google/… and
 * g.co/kgs/… (places shared from Google Search or the Google app).
 */
export function isGoogleShortLink(url: string | null | undefined): boolean {
  const u = url ? parse(url) : null
  if (!u) return false
  const host = u.hostname.toLowerCase()
  return isShortMapsLink(url) || (host === 'share.google' && u.pathname.length > 1) || (host === 'g.co' && u.pathname.startsWith('/kgs/'))
}

export function isGoogleMapsLink(url: string | null | undefined): boolean {
  const u = url ? parse(url) : null
  if (!u) return false
  if (isShortMapsLink(url)) return true
  const host = u.hostname.toLowerCase()
  if (!GOOGLE_HOST.test(host)) return false
  return host.startsWith('maps.') || u.pathname.startsWith('/maps')
}

/** google.com/search?q=… (where share.google links for places usually lead). */
function isGoogleSearchLink(url: string): boolean {
  const u = parse(url)
  return !!u && GOOGLE_HOST.test(u.hostname) && u.pathname === '/search' && !!u.searchParams.get('q')
}

/** A Google link that can name a place: Maps links, Google short share links and Google searches. */
export function isGooglePlaceLink(url: string | null | undefined): boolean {
  return !!url && (isGoogleMapsLink(url) || isGoogleShortLink(url) || isGoogleSearchLink(url))
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

/** Name (and position, for Maps links) from a full Google Maps or Google Search link. */
export function parseGoogleLink(url: string): MapsLinkInfo | null {
  if (isGoogleMapsLink(url)) return parseGoogleMapsLink(url)
  if (!isGoogleSearchLink(url)) return null
  const q = parse(url)!.searchParams.get('q')
  const name = q ? decodeName(q) : null
  return name ? { name, lat: null, lng: null } : null
}

const LINK_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; PointsParadise/1.0; +https://github.com/ymv1992/ymv1992.github.io)', Accept: 'text/html' }

/**
 * Follows a short Google share link's redirects (at most 4, Google hosts
 * only) to the full Maps or Search link. Only the redirect address is read;
 * nothing from the pages themselves.
 */
export async function expandGoogleLink(url: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  let current = url
  for (let hop = 0; hop < 4; hop++) {
    if (!isGoogleShortLink(current) && parseGoogleLink(current)) return current
    const res = await fetchImpl(current, { method: 'GET', redirect: 'manual', headers: LINK_HEADERS, signal: AbortSignal.timeout(6000) })
    const next = res.headers.get('location')
    if (res.status < 300 || res.status >= 400 || !next) return null
    let resolved = new URL(next, current)
    // A cookie-consent stop on the way: its continue= address is where the link goes.
    if (CONSENT_HOST.test(resolved.hostname)) {
      const cont = resolved.searchParams.get('continue')
      const target = cont ? parse(cont) : null
      if (!target) return null
      resolved = target
    }
    const href = resolved.toString()
    if (!isGoogleShortLink(href) && !GOOGLE_HOST.test(resolved.hostname)) return null
    current = href
  }
  return !isGoogleShortLink(current) && parseGoogleLink(current) ? current : null
}
