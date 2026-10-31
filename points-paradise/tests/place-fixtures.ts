/** Fake Wikimedia and map-service responses shared by the place tests (TEST FIXTURES). */

type Route = (u: URL, init?: RequestInit) => Response | null
export function router(routes: Record<string, Route>, calls: URL[] = []) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(input))
    calls.push(u)
    const r = routes[u.hostname]?.(u, init)
    return r ?? new Response('not found', { status: 404 })
  }) as typeof fetch
}
export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export const commonsOk = (file: string, extra: Record<string, unknown> = {}) =>
  json({
    query: {
      pages: [
        {
          title: `File:${file}`,
          imageinfo: [
            {
              thumburl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${file}/800px-${file}`,
              descriptionurl: `https://commons.wikimedia.org/wiki/File:${file}`,
              mime: 'image/jpeg',
              extmetadata: { Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Starr">Forest &amp; Kim Starr</a>' }, LicenseShortName: { value: 'CC BY 3.0' } },
              ...extra,
            },
          ],
        },
      ],
    },
  })

/** OpenStreetMap's answer to "which town is this point in?" */
export const reverseOk = (city: string, countryCode = 'us') => json({ lat: '0', lon: '0', address: { city, country_code: countryCode } })
