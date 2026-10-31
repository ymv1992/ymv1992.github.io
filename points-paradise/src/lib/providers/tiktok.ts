/**
 * Reads a shared TikTok video through TikTok's public embed information
 * (oEmbed: the caption, creator and video id that websites use to embed a
 * video). Nothing is searched or downloaded from TikTok; the owner pastes or
 * shares the link.
 */
import { z } from 'zod'

export const TIKTOK_OEMBED = 'https://www.tiktok.com/oembed'

const TIKTOK_HOST = /^(www\.|m\.|vm\.|vt\.)?tiktok\.com$/i

/** A TikTok link (full video link or a short vm./vt./tiktok.com/t/ link). */
export function isTikTokLink(v: string): boolean {
  try {
    const u = new URL(v.trim())
    return u.protocol === 'https:' && TIKTOK_HOST.test(u.hostname)
  } catch {
    return false
  }
}

/** The first TikTok link in shared text ("Check this out! https://vm.tiktok.com/ZM…/"). */
export function findTikTokLink(text: string): string | null {
  for (const m of text.matchAll(/https:\/\/[^\s"'<>]+/g)) if (isTikTokLink(m[0])) return m[0].replace(/[.,!?)]+$/, '')
  return null
}

/** The video id in a full link (…/video/7301234567890123456). */
export function tikTokVideoId(url: string): string | null {
  return url.match(/\/(?:video|photo)\/(\d{8,25})/)?.[1] ?? null
}

/** Follows a short link to the full video link, only through TikTok's own addresses. */
export async function expandTikTokLink(url: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  let current = url.trim()
  for (let hop = 0; hop < 4; hop++) {
    if (tikTokVideoId(current)) return current.split('?')[0]!
    const res = await fetchImpl(current, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PointsParadise/1.0)' }, signal: AbortSignal.timeout(8000) })
    const next = res.headers.get('location')
    if (!next) return null
    current = new URL(next, current).toString()
    if (!isTikTokLink(current)) return null
  }
  return tikTokVideoId(current) ? current.split('?')[0]! : null
}

const oembedSchema = z
  .object({
    title: z.string().optional(),
    author_name: z.string().optional(),
    author_unique_id: z.string().optional(),
    author_url: z.string().optional(),
    html: z.string().optional(),
  })
  .passthrough()

export interface TikTokVideo {
  url: string
  videoId: string
  caption: string
  author: string | null
  authorUrl: string | null
}

/** Caption and creator of a TikTok video, or null when TikTok doesn't share it (private or removed). */
export async function tikTokInfo(url: string, fetchImpl: typeof fetch = fetch): Promise<TikTokVideo | null> {
  const res = await fetchImpl(`${TIKTOK_OEMBED}?${new URLSearchParams({ url })}`, { signal: AbortSignal.timeout(8000) })
  if (res.status === 400 || res.status === 404) return null
  if (!res.ok) throw new Error(`TikTok responded ${res.status}`)
  const r = oembedSchema.safeParse(await res.json())
  if (!r.success) return null
  const videoId = tikTokVideoId(url) ?? r.data.html?.match(/data-video-id="(\d+)"/)?.[1] ?? null
  if (!videoId) return null
  const authorUrl = r.data.author_url && /^https:\/\/www\.tiktok\.com\/@/.test(r.data.author_url) ? r.data.author_url : null
  return { url, videoId, caption: (r.data.title ?? '').trim().slice(0, 2000), author: r.data.author_unique_id ?? r.data.author_name ?? null, authorUrl }
}

/**
 * Where a caption says the video was filmed, best guess first: a 📍 pin
 * ("📍 Pastéis de Belém, Lisbon"), "Location:"/"Where:", or "at <Place>".
 * Never invents a place; an empty list means the owner types it.
 */
export function placesInCaption(caption: string): string[] {
  const out: string[] = []
  const push = (v: string | undefined) => {
    const t = (v ?? '')
      .replace(/[#@][\p{L}\p{N}_.]+/gu, '')
      .replace(/[\p{Extended_Pictographic}️‍]/gu, '')
      .replace(/\s+/g, ' ')
      .replace(/^[\s:,\-–—|]+|[\s:,\-–—|.!]+$/g, '')
      .trim()
    if (t.length >= 3 && t.length <= 120 && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t)
  }
  for (const m of caption.matchAll(/📍\s*([^\n#📍]+)/gu)) push(m[1])
  for (const m of caption.matchAll(/\b(?:location|where|address|place)\s*[:\-–]\s*([^\n#]+)/giu)) push(m[1])
  for (const m of caption.matchAll(/\b(?:at|in)\s+((?:[A-ZÀ-Ý][\p{L}'’.&-]*\s?){1,6})/gu)) push(m[1])
  return out.slice(0, 5)
}

/** TikTok's embeddable player for a video. */
export function tikTokPlayerUrl(videoId: string): string {
  return `https://www.tiktok.com/player/v1/${videoId}?description=1&music_info=0`
}
