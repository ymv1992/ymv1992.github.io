/**
 * Real photos of places from Wikipedia and Wikimedia Commons (free, no key).
 * A photo is only used when the article clearly is this place (its name
 * matches and it sits near the map pin) and the file is freely licensed on
 * Commons. The photographer and licence are kept for the credit line.
 */
import type { PlacePhoto } from '../db/schema'
import { PLACES_USER_AGENT } from './nominatim'

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php'
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php'
const wikipediaApi = (lang: string) => `https://${lang}.wikipedia.org/w/api.php`
const PHOTO_WIDTH = 800

export async function api(base: string, params: Record<string, string>, fetchImpl: typeof fetch): Promise<unknown> {
  const qs = new URLSearchParams({ format: 'json', formatversion: '2', ...params })
  const res = await fetchImpl(`${base}?${qs}`, { headers: { 'User-Agent': PLACES_USER_AGENT }, signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`Wikimedia responded ${res.status}`)
  return res.json()
}

function tokens(s: string): Set<string> {
  return new Set(
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[’']/g, '')
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1 && !['the', 'of', 'and', 'at', 'in', 'on', 'de', 'la', 'le'].includes(t)),
  )
}

/** Share of the article title's words that appear in the place name (1 = every word). */
export function titleMatch(title: string, name: string): number {
  const t = tokens(title.replace(/\s*\(.*\)\s*$/, ''))
  const n = tokens(name)
  if (!t.size) return 0
  let hit = 0
  for (const w of t) if (n.has(w)) hit++
  return hit / t.size
}

export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = (d: number) => (d * Math.PI) / 180
  const h = Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLng - aLng) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

function plain(html: string | undefined): string {
  return (html ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

type Pages = { pages?: { title: string; index?: number; pageimage?: string; missing?: boolean; coordinates?: { lat: number; lon: number }[] }[] }

/** The article's lead image file name, for an article named by OpenStreetMap ("en:Title"). */
async function fileFromWikipedia(tag: string, fetchImpl: typeof fetch): Promise<string | null> {
  const m = tag.match(/^([a-z]{2,3}):(.+)$/)
  if (!m) return null
  const data = (await api(wikipediaApi(m[1]!), { action: 'query', prop: 'pageimages', piprop: 'name', titles: m[2]! }, fetchImpl)) as { query?: Pages }
  return data.query?.pages?.[0]?.pageimage ?? null
}

/** The "image" (P18) of a Wikidata item named by OpenStreetMap. */
async function fileFromWikidata(id: string, fetchImpl: typeof fetch): Promise<string | null> {
  if (!/^Q\d+$/.test(id)) return null
  const data = (await api(WIKIDATA_API, { action: 'wbgetclaims', entity: id, property: 'P18' }, fetchImpl)) as {
    claims?: { P18?: { mainsnak?: { datavalue?: { value?: string } } }[] }
  }
  return data.claims?.P18?.[0]?.mainsnak?.datavalue?.value ?? null
}

/** Searches English Wikipedia for the place and keeps an article whose name matches and which is near the pin. */
async function fileFromSearch(name: string, lat: number, lng: number, fetchImpl: typeof fetch): Promise<string | null> {
  const data = (await api(
    wikipediaApi('en'),
    { action: 'query', generator: 'search', gsrsearch: name.slice(0, 200), gsrlimit: '5', gsrnamespace: '0', prop: 'coordinates|pageimages', piprop: 'name', colimit: 'max' },
    fetchImpl,
  )) as { query?: Pages }
  const pages = [...(data.query?.pages ?? [])].sort((a, b) => (a.index ?? 99) - (b.index ?? 99))
  for (const p of pages) {
    const c = p.coordinates?.[0]
    if (!p.pageimage || !c) continue
    const km = distanceKm(lat, lng, c.lat, c.lon)
    const match = titleMatch(p.title, name)
    if ((km <= 2 && match >= 0.5) || (km <= 25 && match >= 0.99)) return p.pageimage
  }
  return null
}

type CommonsPage = {
  title?: string
  missing?: boolean
  imageinfo?: {
    thumburl?: string
    descriptionurl?: string
    mime?: string
    extmetadata?: Record<string, { value?: string } | undefined>
  }[]
}

/** A Commons file's credit and resized copy; null unless it is a freely licensed photo hosted on Commons. */
function photoFromPage(page: CommonsPage | undefined): PlacePhoto | null {
  const info = page?.imageinfo?.[0]
  if (!page || page.missing || !info?.thumburl || !info.descriptionurl) return null
  // Photos only: maps, logos and diagrams are usually SVG or PNG.
  if (info.mime !== 'image/jpeg' && info.mime !== 'image/webp') return null
  const meta = info.extmetadata ?? {}
  if (plain(meta.NonFree?.value) === 'true') return null
  const license = plain(meta.LicenseShortName?.value)
  if (!license) return null
  const credit = plain(meta.Artist?.value) || plain(meta.Credit?.value) || 'Wikimedia Commons contributor'
  if (!/^https:\/\/upload\.wikimedia\.org\//.test(info.thumburl) || !/^https:\/\/commons\.wikimedia\.org\//.test(info.descriptionurl)) return null
  return { url: info.thumburl, pageUrl: info.descriptionurl, credit: credit.slice(0, 120), license: license.slice(0, 60), source: 'wikimedia' }
}

async function commonsPhoto(file: string, fetchImpl: typeof fetch): Promise<PlacePhoto | null> {
  const data = (await api(COMMONS_API, { action: 'query', titles: `File:${file}`, prop: 'imageinfo', iiprop: 'url|mime|extmetadata', iiurlwidth: String(PHOTO_WIDTH) }, fetchImpl)) as {
    query?: { pages?: CommonsPage[] }
  }
  return photoFromPage(data.query?.pages?.[0])
}

/** "some_file.jpg" or "File:Some file.jpg" → "Some file.jpg", as Commons names it. */
export function commonsName(file: string): string {
  const name = file
    .replace(/^(file|image):/i, '')
    .replace(/_/g, ' ')
    .trim()
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/** Photos for many Commons files at once (50 per request). Files that aren't free photos are left out. */
export async function commonsPhotos(files: readonly string[], fetchImpl: typeof fetch = fetch): Promise<{ photos: Map<string, PlacePhoto>; requests: number }> {
  const names = [...new Set(files.map(commonsName).filter(Boolean))]
  const photos = new Map<string, PlacePhoto>()
  let requests = 0
  for (let i = 0; i < names.length; i += 50) {
    const batch = names.slice(i, i + 50)
    requests++
    const data = (await api(COMMONS_API, { action: 'query', titles: batch.map((n) => `File:${n}`).join('|'), prop: 'imageinfo', iiprop: 'url|mime|extmetadata', iiurlwidth: String(PHOTO_WIDTH) }, fetchImpl)) as {
      query?: { pages?: CommonsPage[] }
    }
    for (const page of data.query?.pages ?? []) {
      const photo = photoFromPage(page)
      if (photo && page.title) photos.set(commonsName(page.title), photo)
    }
  }
  return { photos, requests }
}

/** A photo of the place, or null when no freely licensed photo clearly shows it. */
export async function findPlacePhoto(
  p: { name: string | null; lat: number; lng: number; wikipedia?: string | null; wikidata?: string | null },
  fetchImpl: typeof fetch = fetch,
): Promise<{ photo: PlacePhoto | null; requests: number }> {
  let requests = 0
  const tries: (() => Promise<string | null>)[] = []
  if (p.wikidata) tries.push(() => fileFromWikidata(p.wikidata!, fetchImpl))
  if (p.wikipedia) tries.push(() => fileFromWikipedia(p.wikipedia!, fetchImpl))
  if (p.name) tries.push(() => fileFromSearch(p.name!, p.lat, p.lng, fetchImpl))
  for (const t of tries) {
    requests++
    const file = await t()
    if (!file) continue
    requests++
    const photo = await commonsPhoto(file, fetchImpl)
    if (photo) return { photo, requests }
  }
  return { photo: null, requests }
}
