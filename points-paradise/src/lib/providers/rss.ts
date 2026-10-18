/**
 * Minimal RSS/Atom reader for public deal and promotion announcements. Only
 * titles, links and dates are kept; matching items become unverified leads.
 */

export interface FeedItem {
  title: string
  url: string
  publishedAt: Date | null
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

export function decodeText(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
        return Number.isFinite(code) ? String.fromCodePoint(code) : m
      }
      return ENTITIES[e.toLowerCase()] ?? m
    })
    .replace(/\s+/g, ' ')
    .trim()
}

function tag(block: string, name: string): string | null {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block)
  return m ? m[1]! : null
}

function safeUrl(u: string | null): string | null {
  if (!u) return null
  try {
    const url = new URL(u.trim())
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

export function parseFeed(xml: string): FeedItem[] {
  const out: FeedItem[] = []
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? []
  for (const it of items) {
    const title = decodeText(tag(it, 'title') ?? '')
    const url = safeUrl(decodeText(tag(it, 'link') ?? ''))
    const date = tag(it, 'pubDate') ?? tag(it, 'dc:date')
    if (title && url) out.push({ title: title.slice(0, 300), url, publishedAt: date ? new Date(decodeText(date)) : null })
  }
  const entries = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? []
  for (const en of entries) {
    const title = decodeText(tag(en, 'title') ?? '')
    const href = /<link[^>]*href="([^"]+)"/i.exec(en)?.[1] ?? null
    const url = safeUrl(href ? decodeText(href) : null)
    const date = tag(en, 'updated') ?? tag(en, 'published')
    if (title && url) out.push({ title: title.slice(0, 300), url, publishedAt: date ? new Date(decodeText(date)) : null })
  }
  return out.map((i) => ({ ...i, publishedAt: i.publishedAt && !Number.isNaN(i.publishedAt.getTime()) ? i.publishedAt : null }))
}

const CHASE = /\b(chase|ultimate rewards|sapphire)\b/i
const INTEREST = /(transfer bonus|bonus|sweet spot|award|business class|first class|mistake fare|sale)/i

/** Keywords that made an item relevant, or null if it is not about Chase points travel. */
export function matchKeywords(title: string): string[] | null {
  if (!CHASE.test(title)) return null
  const hits = [CHASE.exec(title)?.[0], INTEREST.exec(title)?.[0]].filter((x): x is string => !!x).map((x) => x.toLowerCase())
  return hits.length >= 2 ? hits : null
}

export async function fetchFeed(url: string, fetchImpl: typeof fetch = fetch): Promise<FeedItem[]> {
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'PointsParadise/1.0 (personal RSS reader)' }, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`Feed responded ${res.status}`)
  const text = await res.text()
  if (text.length > 3_000_000) throw new Error('Feed too large')
  return parseFeed(text)
}
