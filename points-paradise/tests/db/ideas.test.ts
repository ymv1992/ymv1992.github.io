/** Ideas: the Wikivoyage deck (like, skip, bring back) and saved TikToks, with fake services (TEST FIXTURES). */
import { beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/client'
import { searchJobs, tripItems } from '@/lib/db/schema'
import { ensureOwnerAccount } from '@/lib/data/account'
import { addTikTokIdea, cityGuide, dismissTikTok, ideaDeck, likeGuideIdea, listTikToks, orderDeck, saveTikTok, skipGuideIdea, unskipGuideIdeas, type GuideCard } from '@/lib/data/ideas'
import { createTrip, getTrip, tripInputSchema } from '@/lib/data/trips'
import { NOW } from '../fixtures'
import { json, reverseOk, router } from '../place-fixtures'
import { createTestDb } from '../test-db'

let db: AppDb
let userId: string
let tripId: string

const GUIDE = `==See==
* {{see | name=Jerónimos Monastery | lat=38.6979 | long=-9.2065 | image=Jeronimos.jpg | content=Grand monastery. }}
* {{see | name=Belém Tower | lat=38.6916 | long=-9.2160 | content=Fortified tower. }}
==Do==
* {{do | name=Tram 28 | content=Old yellow tram. }}
==Eat==
* {{eat | name=Pastéis de Belém | address=Rua de Belém 84 | lat=38.6975 | long=-9.2033 | image=Pasteis.jpg | content=Custard tarts. }}
* {{eat | name=No description }}`

function services(calls: URL[] = []) {
  return router(
    {
      'en.wikivoyage.org': (u) => {
        const p = Object.fromEntries(u.searchParams)
        if (p.prop === 'pageprops') return json({ query: { pages: [{ title: p.titles === 'Atlantis' ? 'Atlantis' : 'Lisbon', missing: p.titles === 'Atlantis' }] } })
        if (p.list === 'search') return json({ query: { search: [] } })
        if (p.list === 'allpages') return json({ query: { allpages: [] } })
        if (p.prop === 'revisions') return json({ query: { pages: [{ title: 'Lisbon', revisions: [{ slots: { main: { content: GUIDE } } }] }] } })
        return null
      },
      'commons.wikimedia.org': (u) => {
        const titles = u.searchParams.get('titles')!.split('|')
        expect(titles).toEqual(['File:Jeronimos.jpg', 'File:Pasteis.jpg'])
        return json({
          query: {
            pages: titles.map((t) => ({
              title: t,
              imageinfo: [{ thumburl: `https://upload.wikimedia.org/x/${t.slice(5)}`, descriptionurl: `https://commons.wikimedia.org/wiki/${t}`, mime: 'image/jpeg', extmetadata: { Artist: { value: 'A. Photographer' }, LicenseShortName: { value: 'CC BY-SA 4.0' } } }],
            })),
          },
        })
      },
      'www.tiktok.com': (u) =>
        u.pathname === '/oembed'
          ? json({ title: '📍Pastéis de Belém, Lisbon\nbest tarts #lisbon', author_unique_id: 'lisbonfood', author_url: 'https://www.tiktok.com/@lisbonfood' })
          : null,
      'vm.tiktok.com': () => new Response(null, { status: 301, headers: { location: 'https://www.tiktok.com/@lisbonfood/video/7301234567890123456' } }),
      'nominatim.openstreetmap.org': (u) => (u.pathname === '/reverse' ? reverseOk('Lisbon', 'pt') : json([{ lat: '38.6975', lon: '-9.2033', name: 'Pastéis de Belém', boundingbox: ['38.697', '38.698', '-9.204', '-9.203'] }])),
      'en.wikipedia.org': () => json({ query: { pages: [] } }),
    },
    calls,
  )
}
const deps = (calls: URL[] = []) => ({ fetch: services(calls), now: NOW, minIntervalMs: 0 })

beforeAll(async () => {
  db = await createTestDb()
  userId = await ensureOwnerAccount(db, 'owner@example.com')
  tripId = await createTrip(db, userId, tripInputSchema.parse({ name: 'Lisbon', destination: 'Lisbon, Portugal', startDate: '2026-11-10', endDate: '2026-11-14' }))
}, 60_000)

describe('city guides', () => {
  it('load once with their photos, then come from the cache', async () => {
    const calls: URL[] = []
    const g = await cityGuide(db, 'Lisbon', deps(calls))
    expect(g?.title).toBe('Lisbon')
    expect(g?.listings.map((l) => [l.name, !!l.photo])).toEqual([
      ['Jerónimos Monastery', true],
      ['Belém Tower', false],
      ['Tram 28', false],
      ['Pastéis de Belém', true],
      ['No description', false],
    ])
    expect(g?.listings[0]!.photo).toMatchObject({ credit: 'A. Photographer', license: 'CC BY-SA 4.0' })
    const used = calls.length
    await cityGuide(db, 'Lisbon', deps(calls))
    expect(calls.length).toBe(used)
    expect(await cityGuide(db, 'Atlantis', deps())).toMatchObject({ title: null, listings: [] })
  })

  it('deal photos first and mix sights, things to do and food; cards with nothing to show are left out', () => {
    const c = (name: string, type: GuideCard['type'], photo: boolean, content = 'x'): GuideCard => ({
      key: name,
      type,
      name,
      alt: null,
      url: null,
      address: null,
      lat: null,
      lng: null,
      hours: null,
      price: null,
      content,
      image: null,
      page: 'Lisbon',
      photo: photo ? { url: 'u', pageUrl: 'p', credit: 'c', license: 'l', source: 'wikimedia' } : null,
    })
    const cards = [c('s1', 'see', false), c('s2', 'see', true), c('e1', 'eat', true), c('d1', 'do', false), c('e2', 'eat', false, '')]
    expect(orderDeck(cards, new Set()).map((x) => x.name)).toEqual(['s2', 'd1', 'e1', 's1'])
    expect(orderDeck(cards, new Set(['s2'])).map((x) => x.name)).toEqual(['s1', 'd1', 'e1'])
  })
})

describe('the idea deck', () => {
  it('adds a liked idea to the trip’s Ideas with its pin, photo and credit, and leaves it out of the deck', async () => {
    const before = await ideaDeck(db, userId, tripId, 'Lisbon', deps())
    expect(before?.cards.map((c) => c.name)).toEqual(['Jerónimos Monastery', 'Tram 28', 'Pastéis de Belém', 'Belém Tower'])
    const key = before!.cards[0]!.key
    const r = await likeGuideIdea(db, userId, tripId, 'Lisbon', key, { ...deps(), countryCode: 'PT' })
    expect(r).toMatchObject({ ok: true, title: 'Jerónimos Monastery' })
    const [item] = await db.select().from(tripItems).where(eq(tripItems.id, (r as { itemId: string }).itemId))
    expect(item).toMatchObject({ day: null, kind: 'activity', title: 'Jerónimos Monastery', lat: 38.6979, lng: -9.2065, city: 'Lisbon', countryCode: 'PT', photo: { credit: 'A. Photographer' } })
    expect(item!.notes).toContain('From Wikivoyage’s Lisbon guide (CC BY-SA 4.0).')
    expect(item!.url).toBe('https://en.wikivoyage.org/wiki/Lisbon')

    const eat = before!.cards.find((c) => c.type === 'eat')!
    const food = await likeGuideIdea(db, userId, tripId, 'Lisbon', eat.key, deps())
    expect((await db.select().from(tripItems).where(eq(tripItems.id, (food as { itemId: string }).itemId)))[0]).toMatchObject({ kind: 'food', place: 'Pastéis de Belém, Rua de Belém 84' })

    await skipGuideIdea(db, userId, tripId, 'Lisbon', before!.cards[1]!.key, deps())
    const after = await ideaDeck(db, userId, tripId, 'Lisbon', deps())
    expect(after?.cards.map((c) => c.name)).toEqual(['Belém Tower'])
    expect([after?.liked, after?.skipped]).toEqual([2, 1])
    expect(await unskipGuideIdeas(db, userId, tripId)).toBe(1)
    expect((await ideaDeck(db, userId, tripId, 'Lisbon', deps()))?.cards.map((c) => c.name)).toEqual(['Belém Tower', 'Tram 28'])
  })

  it('belongs to the trip owner only', async () => {
    const other = await ensureOwnerAccount(db, 'other@example.com')
    expect(await ideaDeck(db, other, tripId, 'Lisbon', deps())).toBeNull()
    expect(await likeGuideIdea(db, other, tripId, 'Lisbon', 'lisbon|see|belém tower', deps())).toEqual({ ok: false, error: 'Trip not found' })
  })
})

describe('saved TikToks', () => {
  it('read the caption, find the place near the trip, and add it only once confirmed', async () => {
    const r = await saveTikTok(db, userId, tripId, 'look! https://vm.tiktok.com/ZMabc/ 😍', deps())
    expect(r).toMatchObject({ ok: true, found: true, title: 'Pastéis de Belém, Lisbon' })
    const before = (await getTrip(db, userId, tripId))!.items.length
    const [saved] = await listTikToks(db, userId, tripId)
    expect(saved).toMatchObject({ status: 'new', key: '7301234567890123456', data: { lat: 38.6975, sourceTitle: 'lisbonfood', videoId: '7301234567890123456', candidates: ['Pastéis de Belém, Lisbon'] } })
    expect((await getTrip(db, userId, tripId))!.items).toHaveLength(before)

    const added = await addTikTokIdea(db, userId, saved!.id, 'Pastéis de Belém', deps())
    if (!added.ok) throw new Error(added.error)
    const [item] = await db.select().from(tripItems).where(eq(tripItems.id, added.itemId))
    expect(item).toMatchObject({ title: 'Pastéis de Belém', place: 'Pastéis de Belém', url: 'https://www.tiktok.com/@lisbonfood/video/7301234567890123456', lat: 38.6975, city: 'Lisbon', day: null })
    expect(item!.notes).toContain('Saved from TikTok by @lisbonfood.')
    expect((await listTikToks(db, userId, tripId))[0]).toMatchObject({ status: 'liked', itemId: added.itemId })
    const jobs = await db.select().from(searchJobs).where(eq(searchJobs.provider, 'tiktok'))
    expect(jobs[0]).toMatchObject({ jobType: 'tiktok_save', status: 'succeeded', requestCount: 2 })
  })

  it('explain links that aren’t TikToks or can’t be read, and can be dismissed', async () => {
    expect(await saveTikTok(db, userId, tripId, 'https://www.instagram.com/p/abc', deps())).toEqual({
      ok: false,
      error: 'Paste a TikTok link (it starts with https://www.tiktok.com or https://vm.tiktok.com).',
    })
    const private_ = { fetch: router({ 'www.tiktok.com': () => new Response('{}', { status: 404 }) }), now: NOW, minIntervalMs: 0 }
    expect(await saveTikTok(db, userId, tripId, 'https://www.tiktok.com/@x/video/1234567890123', private_)).toEqual({ ok: false, error: 'TikTok doesn’t share this video (it may be private or removed).' })
    const [saved] = await listTikToks(db, userId, tripId)
    const other = await ensureOwnerAccount(db, 'other@example.com')
    await dismissTikTok(db, other, saved!.id)
    expect((await listTikToks(db, userId, tripId))[0]!.status).toBe('liked')
  })
})
