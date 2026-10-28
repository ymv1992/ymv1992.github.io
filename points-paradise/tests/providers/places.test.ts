/** Google Maps links, OpenStreetMap place search and Wikimedia photos, with fake responses (TEST FIXTURES). */
import { describe, expect, it } from 'vitest'
import { expandGoogleLink, isGoogleMapsLink, isGooglePlaceLink, isGoogleShortLink, isShortMapsLink, parseGoogleLink, parseGoogleMapsLink } from '@/lib/places/google-maps-link'
import { geocode, PLACES_USER_AGENT } from '@/lib/providers/nominatim'
import { findPlacePhoto, titleMatch } from '@/lib/providers/wikimedia'
import { osmEmbedUrl } from '@/lib/trips/shared'
import { commonsOk, json, router } from '../place-fixtures'


describe('Google Maps links', () => {
  it('read the place name and its exact pin, not just the map view', () => {
    const link = 'https://www.google.com/maps/place/Mama%E2%80%99s+Fish+House/@20.9381,-156.3567,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d20.9389!4d-156.3549!16s%2Fg%2F1tf'
    expect(parseGoogleMapsLink(link)).toEqual({ name: 'Mama’s Fish House', lat: 20.9389, lng: -156.3549 })
  })

  it('handle the other link shapes', () => {
    expect(parseGoogleMapsLink('https://maps.google.com/?q=20.6343,-156.4966')).toEqual({ name: null, lat: 20.6343, lng: -156.4966 })
    expect(parseGoogleMapsLink('https://www.google.com/maps/search/?api=1&query=Haleakala+National+Park')).toEqual({ name: 'Haleakala National Park', lat: null, lng: null })
    expect(parseGoogleMapsLink('https://www.google.com/maps/@20.7,-156.2,12z')).toEqual({ name: null, lat: 20.7, lng: -156.2 })
    expect(parseGoogleMapsLink('https://www.google.co.uk/maps/place/Big+Ben/@51.5007,-0.1246,17z')).toMatchObject({ name: 'Big Ben', lat: 51.5007 })
  })

  it('tell Google Maps links from everything else', () => {
    expect(isShortMapsLink('https://maps.app.goo.gl/AbC123xyz')).toBe(true)
    expect(isGoogleMapsLink('https://maps.app.goo.gl/AbC123xyz')).toBe(true)
    expect(parseGoogleMapsLink('https://maps.app.goo.gl/AbC123xyz')).toBeNull()
    expect(isGoogleMapsLink('https://goo.gl/AbC')).toBe(false)
    expect(isGoogleMapsLink('https://www.google.com/search?q=maui')).toBe(false)
    expect(isGoogleMapsLink('https://evil.example/maps/place/x')).toBe(false)
    expect(isGoogleMapsLink('https://google.com.evil.example/maps')).toBe(false)
    expect(isGoogleMapsLink('javascript:alert(1)')).toBe(false)
    expect(parseGoogleMapsLink('https://www.google.com/maps/@95,10,3z')).toBeNull()
  })

  it('expand short share links by following Google redirects only', async () => {
    const full = 'https://www.google.com/maps/place/Molokini/@20.63,-156.49,14z/data=!3d20.6339!4d-156.4964'
    const calls: URL[] = []
    const ok = router({ 'maps.app.goo.gl': () => new Response(null, { status: 302, headers: { location: full } }) }, calls)
    expect(await expandGoogleLink('https://maps.app.goo.gl/AbC', ok)).toBe(full)
    expect(calls).toHaveLength(1)
    const evil = router({ 'maps.app.goo.gl': () => new Response(null, { status: 302, headers: { location: 'https://evil.example/x' } }) })
    expect(await expandGoogleLink('https://maps.app.goo.gl/AbC', evil)).toBeNull()
  })

  it('read share.google links, which lead to a Google search for the place', async () => {
    const link = 'https://share.google/Qi3LxU6EOSquROmFc'
    expect(isGoogleShortLink(link)).toBe(true)
    expect(isGooglePlaceLink(link)).toBe(true)
    expect(isGoogleMapsLink(link)).toBe(false)
    expect(isGoogleShortLink('https://g.co/kgs/AbCd')).toBe(true)
    expect(isGoogleShortLink('https://share.google/')).toBe(false)
    const search = 'https://www.google.com/search?q=Capela+das+Almas&kgmid=/g/11b6&shem=abc&utm_source=share'
    const f = router({ 'share.google': () => new Response(null, { status: 302, headers: { location: search } }) })
    const full = await expandGoogleLink(link, f)
    expect(full).toBe(search)
    expect(parseGoogleLink(full!)).toEqual({ name: 'Capela das Almas', lat: null, lng: null })
  })

  it('step past a cookie-consent page to where the link goes', async () => {
    const target = 'https://www.google.com/maps/place/Livraria+Lello/@41.14,-8.61,17z/data=!3d41.1468617!4d-8.6148257'
    const f = router({
      'share.google': () => new Response(null, { status: 302, headers: { location: `https://consent.google.com/m?continue=${encodeURIComponent(target)}&gl=PT` } }),
    })
    expect(parseGoogleLink((await expandGoogleLink('https://share.google/xyz', f))!)).toEqual({ name: 'Livraria Lello', lat: 41.1468617, lng: -8.6148257 })
    // A page instead of a redirect (or a non-Google destination) gives nothing rather than a guess.
    expect(await expandGoogleLink('https://share.google/xyz', router({ 'share.google': () => new Response('<html>', { status: 200 }) }))).toBeNull()
  })
})

describe('OpenStreetMap place search', () => {
  it('identifies the app and reads position, size and Wikipedia tags', async () => {
    let agent: string | null = null
    const f = router({
      'nominatim.openstreetmap.org': (u, init) => {
        agent = new Headers(init?.headers).get('user-agent')
        expect(u.searchParams.get('q')).toBe('Molokini, Maui')
        return json([{ lat: '20.6339', lon: '-156.4964', name: 'Molokini', boundingbox: ['20.62', '20.64', '-156.50', '-156.48'], extratags: { wikidata: 'Q1151829', wikipedia: 'en:Molokini' } }])
      },
    })
    expect(await geocode('Molokini, Maui', f)).toEqual({ lat: 20.6339, lng: -156.4964, name: 'Molokini', span: expect.closeTo(0.02, 5), wikipedia: 'en:Molokini', wikidata: 'Q1151829' })
    expect(agent).toBe(PLACES_USER_AGENT)
    expect(await geocode('Nowhere', router({ 'nominatim.openstreetmap.org': () => json([]) }))).toBeNull()
  })
})

describe('Wikimedia photos', () => {
  const wiki = (pages: unknown[]) => json({ query: { pages } })

  it('compare article titles with place names', () => {
    expect(titleMatch('Molokini', 'Snorkel at Molokini Crater')).toBe(1)
    expect(titleMatch('Haleakalā National Park', 'Haleakala National Park')).toBe(1)
    expect(titleMatch('Maui', 'Mama’s Fish House')).toBe(0)
  })

  it('use the photo OpenStreetMap links to, with its credit', async () => {
    const f = router({
      'www.wikidata.org': () => json({ claims: { P18: [{ mainsnak: { datavalue: { value: 'Molokini_crater.jpg' } } }] } }),
      'commons.wikimedia.org': () => commonsOk('Molokini_crater.jpg'),
    })
    const r = await findPlacePhoto({ name: 'Molokini', lat: 20.63, lng: -156.49, wikidata: 'Q1151829' }, f)
    expect(r.photo).toEqual({
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Molokini_crater.jpg/800px-Molokini_crater.jpg',
      pageUrl: 'https://commons.wikimedia.org/wiki/File:Molokini_crater.jpg',
      credit: 'Forest & Kim Starr',
      license: 'CC BY 3.0',
      source: 'wikimedia',
    })
  })

  it('only trust a search result whose name matches and which is near the pin', async () => {
    const pages = [
      { title: 'Lahaina', index: 1, pageimage: 'Lahaina.jpg', coordinates: [{ lat: 20.87, lon: -156.67 }] },
      { title: 'Molokini', index: 2, pageimage: 'Molokini_far.jpg', coordinates: [{ lat: 21.5, lon: -157.9 }] },
      { title: 'Molokini', index: 3, pageimage: 'Molokini_crater.jpg', coordinates: [{ lat: 20.633, lon: -156.496 }] },
    ]
    const f = router({ 'en.wikipedia.org': () => wiki(pages), 'commons.wikimedia.org': (u) => commonsOk(u.searchParams.get('titles')!.slice(5)) })
    expect((await findPlacePhoto({ name: 'Molokini', lat: 20.6339, lng: -156.4964 }, f)).photo?.pageUrl).toMatch(/Molokini_crater\.jpg$/)
    // A restaurant with no article of its own gets no photo rather than a nearby town's.
    expect((await findPlacePhoto({ name: 'Mama’s Fish House', lat: 20.9389, lng: -156.3549 }, f)).photo).toBeNull()
  })

  it('skip files that are not free, not on Commons, or not photos', async () => {
    const search = () => wiki([{ title: 'Molokini', index: 1, pageimage: 'X.jpg', coordinates: [{ lat: 20.633, lon: -156.496 }] }])
    const place = { name: 'Molokini', lat: 20.6339, lng: -156.4964 }
    const nonFree = router({ 'en.wikipedia.org': search, 'commons.wikimedia.org': () => commonsOk('X.jpg', { extmetadata: { NonFree: { value: 'true' }, LicenseShortName: { value: 'Fair use' } } }) })
    expect((await findPlacePhoto(place, nonFree)).photo).toBeNull()
    const local = router({ 'en.wikipedia.org': search, 'commons.wikimedia.org': () => json({ query: { pages: [{ title: 'File:X.jpg', missing: true }] } }) })
    expect((await findPlacePhoto(place, local)).photo).toBeNull()
    const svg = router({ 'en.wikipedia.org': search, 'commons.wikimedia.org': () => commonsOk('X.jpg', { mime: 'image/svg+xml' }) })
    expect((await findPlacePhoto(place, svg)).photo).toBeNull()
  })
})

describe('map embed', () => {
  it('centres an OpenStreetMap view on the pin, wider for bigger places', () => {
    const cafe = new URL(osmEmbedUrl(20.9389, -156.3549, null))
    expect(cafe.hostname).toBe('www.openstreetmap.org')
    expect(cafe.searchParams.get('marker')).toBe('20.93890,-156.35490')
    const width = (u: URL) => {
      const [w, , e] = u.searchParams.get('bbox')!.split(',').map(Number)
      return e! - w!
    }
    expect(width(new URL(osmEmbedUrl(20.8, -156.3, 1.2)))).toBeGreaterThan(width(cafe) * 10)
  })
})
