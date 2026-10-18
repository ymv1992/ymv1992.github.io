/**
 * Unsplash destination photos. Per the Unsplash API guidelines the returned
 * image URL is hotlinked and the photographer is credited. Photos illustrate
 * the destination, never a specific hotel or seat.
 */
import { z } from 'zod'

const schema = z.object({
  results: z.array(
    z
      .object({
        urls: z.object({ regular: z.string().url(), small: z.string().url().optional() }).passthrough(),
        user: z.object({ name: z.string(), links: z.object({ html: z.string().url() }).passthrough() }).passthrough(),
      })
      .passthrough(),
  ),
})

export interface Photo {
  url: string
  thumbUrl: string | null
  creditName: string
  creditUrl: string
}

const UTM = 'utm_source=points_paradise&utm_medium=referral'

export async function searchDestinationPhoto(accessKey: string, query: string, fetchImpl: typeof fetch = fetch): Promise<Photo | null> {
  const qs = new URLSearchParams({ query, per_page: '1', orientation: 'landscape', content_filter: 'high' })
  const res = await fetchImpl(`https://api.unsplash.com/search/photos?${qs}`, {
    headers: { Authorization: `Client-ID ${accessKey}`, 'Accept-Version': 'v1' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`Unsplash responded ${res.status}`)
  const body = schema.parse(await res.json())
  const r = body.results[0]
  if (!r) return null
  return {
    url: r.urls.regular,
    thumbUrl: r.urls.small ?? null,
    creditName: r.user.name,
    creditUrl: `${r.user.links.html}?${UTM}`,
  }
}
