/**
 * Things to do from Wikivoyage, the free travel guide (text CC BY-SA 4.0).
 * Each city guide lists places in {{see}}, {{do}}, {{eat}}, {{drink}} and
 * {{buy}} templates, often with an address, opening hours, a position and a
 * photo. Big cities split their listings into district pages ("Lisbon/Baixa").
 */
import { PLACES_USER_AGENT } from './nominatim'

export const WIKIVOYAGE_API = 'https://en.wikivoyage.org/w/api.php'
export const WIKIVOYAGE_LICENSE = 'CC BY-SA 4.0'

export type ListingType = 'see' | 'do' | 'eat' | 'drink' | 'buy'
const TYPES = new Set<ListingType>(['see', 'do', 'eat', 'drink', 'buy'])

export interface GuideListing {
  /** Stable id: page, type and name. */
  key: string
  type: ListingType
  name: string
  alt: string | null
  url: string | null
  address: string | null
  lat: number | null
  lng: number | null
  hours: string | null
  price: string | null
  content: string | null
  /** A Commons file name, when the listing names a photo. */
  image: string | null
  /** The guide page it comes from ("Lisbon/Belém"), for credit. */
  page: string
}

/** The end of a {{template}} starting at `start` (index after its "}}"), or -1. */
function templateEnd(text: string, start: number): number {
  let depth = 0
  for (let i = start; i < text.length - 1; i++) {
    if (text[i] === '{' && text[i + 1] === '{') {
      depth++
      i++
    } else if (text[i] === '}' && text[i + 1] === '}') {
      depth--
      i++
      if (depth === 0) return i + 1
    }
  }
  return -1
}

/** Splits template parameters on "|" that aren't inside [[links]] or {{templates}}. */
function splitParams(body: string): string[] {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2)
    if (two === '{{' || two === '[[') {
      depth++
      cur += two
      i++
    } else if ((two === '}}' || two === ']]') && depth > 0) {
      depth--
      cur += two
      i++
    } else if (body[i] === '|' && depth === 0) {
      parts.push(cur)
      cur = ''
    } else cur += body[i]
  }
  parts.push(cur)
  return parts
}

const UNIT = /^(km|mi|m|ft|kg)$/i

/** Plain text from wiki markup: links, bold, small templates, references and tags. */
export function wikiText(v: string): string {
  let t = v
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[\s\S]*?<\/ref>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
  // Inner templates such as {{km|2}} or {{CURRENCY|5|EUR}}: keep their values.
  for (let guard = 0; guard < 5 && /\{\{[^{}]*\}\}/.test(t); guard++) {
    t = t.replace(/\{\{([^{}]*)\}\}/g, (_m, inner: string) => {
      const [name, ...args] = inner.split('|').map((x) => x.trim())
      if (name && UNIT.test(name) && args[0]) return `${args[0]} ${name}`
      return args.filter((a) => !a.includes('=')).join(' ')
    })
  }
  return t
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1')
    .replace(/\[(https?:\/\/[^\s\]]+)\s+([^\]]+)\]/g, '$2')
    .replace(/\[https?:\/\/[^\]]+\]/g, '')
    .replace(/'{2,}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

const num = (v: string | undefined) => {
  const n = Number((v ?? '').trim())
  return v && v.trim() !== '' && Number.isFinite(n) ? n : null
}

/** Every See/Do/Eat/Drink/Buy listing on a guide page. */
export function parseListings(wikitext: string, page: string): GuideListing[] {
  const out: GuideListing[] = []
  for (let i = wikitext.indexOf('{{'); i !== -1; i = wikitext.indexOf('{{', i + 2)) {
    const end = templateEnd(wikitext, i)
    if (end === -1) break
    const body = wikitext.slice(i + 2, end - 2)
    const [rawName, ...rest] = splitParams(body)
    const name = (rawName ?? '').trim().toLowerCase()
    if (!TYPES.has(name as ListingType) && name !== 'listing') continue
    const params: Record<string, string> = {}
    for (const p of rest) {
      const eq = p.indexOf('=')
      if (eq > 0) params[p.slice(0, eq).trim().toLowerCase()] = p.slice(eq + 1).trim()
    }
    const type = (name === 'listing' ? (params.type ?? '').toLowerCase() : name) as ListingType
    const title = wikiText(params.name ?? '')
    if (TYPES.has(type) && title) {
      const url = (params.url ?? '').trim()
      const lat = num(params.lat)
      const lng = num(params.long ?? params.lon)
      out.push({
        key: `${page}|${type}|${title}`.toLowerCase().slice(0, 300),
        type,
        name: title.slice(0, 120),
        alt: wikiText(params.alt ?? '') || null,
        url: /^https?:\/\//i.test(url) ? url.slice(0, 500) : null,
        address: wikiText(params.address ?? '').slice(0, 200) || null,
        lat: lat != null && Math.abs(lat) <= 90 ? lat : null,
        lng: lng != null && Math.abs(lng) <= 180 ? lng : null,
        hours: wikiText(params.hours ?? '').slice(0, 200) || null,
        price: wikiText(params.price ?? '').slice(0, 200) || null,
        content: wikiText(params.content ?? params.description ?? '').slice(0, 900) || null,
        image: (params.image ?? '').trim() || null,
        page,
      })
    }
    i = end - 2
  }
  return out
}

async function api(params: Record<string, string>, fetchImpl: typeof fetch): Promise<unknown> {
  const qs = new URLSearchParams({ format: 'json', formatversion: '2', ...params })
  const res = await fetchImpl(`${WIKIVOYAGE_API}?${qs}`, { headers: { 'User-Agent': PLACES_USER_AGENT }, signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`Wikivoyage responded ${res.status}`)
  return res.json()
}

const words = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** The guide's page title for a city ("Lisbon"), or null when Wikivoyage has no guide for it. */
export async function findGuide(city: string, fetchImpl: typeof fetch = fetch): Promise<{ title: string | null; requests: number }> {
  const direct = (await api({ action: 'query', titles: city, redirects: '1', prop: 'pageprops', ppprop: 'disambiguation' }, fetchImpl)) as {
    query?: { pages?: { title: string; missing?: boolean; pageprops?: { disambiguation?: string } }[] }
  }
  const page = direct.query?.pages?.[0]
  if (page && !page.missing && !page.pageprops?.disambiguation) return { title: page.title, requests: 1 }
  const found = (await api({ action: 'query', list: 'search', srsearch: city, srlimit: '5', srnamespace: '0' }, fetchImpl)) as { query?: { search?: { title: string }[] } }
  const want = words(city)
  const hit = found.query?.search?.find((s) => words(s.title.split('/')[0]!) === want || words(s.title).startsWith(`${want} `))
  return { title: hit?.title.split('/')[0] ?? null, requests: 2 }
}

const MAX_DISTRICTS = 7

/** The guide's wikitext, with its district pages for big cities. */
export async function guidePages(title: string, fetchImpl: typeof fetch = fetch): Promise<{ pages: { title: string; text: string }[]; requests: number }> {
  const sub = (await api({ action: 'query', list: 'allpages', apprefix: `${title}/`, apnamespace: '0', aplimit: '30' }, fetchImpl)) as { query?: { allpages?: { title: string }[] } }
  const districts = (sub.query?.allpages ?? []).map((p) => p.title).filter((t) => !/\/(gallery|routes?|itineraries)/i.test(t))
  const titles = [title, ...districts.slice(0, MAX_DISTRICTS)]
  const data = (await api({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', titles: titles.join('|') }, fetchImpl)) as {
    query?: { pages?: { title: string; missing?: boolean; revisions?: { slots?: { main?: { content?: string } } }[] }[] }
  }
  const pages = (data.query?.pages ?? [])
    .filter((p) => !p.missing && p.revisions?.[0]?.slots?.main?.content)
    .map((p) => ({ title: p.title, text: p.revisions![0]!.slots!.main!.content! }))
    .sort((a, b) => titles.indexOf(a.title) - titles.indexOf(b.title))
  return { pages, requests: 2 }
}

/** Link to a guide page on Wikivoyage. */
export function guideUrl(page: string): string {
  return `https://en.wikivoyage.org/wiki/${encodeURIComponent(page.replace(/ /g, '_')).replace(/%2F/g, '/')}`
}
