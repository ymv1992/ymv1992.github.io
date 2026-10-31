/** Wikivoyage guide listings and TikTok embed info, with fake responses (TEST FIXTURES). */
import { describe, expect, it } from 'vitest'
import { expandTikTokLink, findTikTokLink, isTikTokLink, placesInCaption, tikTokInfo, tikTokVideoId } from '@/lib/providers/tiktok'
import { findGuide, guidePages, guideUrl, parseListings, wikiText } from '@/lib/providers/wikivoyage'
import { json, router } from '../place-fixtures'

const LISBON = `{{pagebanner|Lisbon banner.jpg}}
'''Lisbon''' is the capital.
==See==
* {{see
| name=Jerónimos Monastery | alt=Mosteiro dos Jerónimos | url=https://www.mosteirojeronimos.gov.pt/ | email=
| address=Praça do Império | lat=38.6979 | long=-9.2065 | directions=[[Lisbon/Belém|Belém]]
| phone= | hours=Tu-Su 09:30-18:00 | price=€12
| image=Jeronimos_monastery.jpg
| content=A '''UNESCO''' World Heritage site built in the {{km|1}} [[Manueline]] style.<ref>source</ref> Arrive early.
}}
* {{listing | type=do | name=Tram 28 | content=The classic yellow tram through [[Alfama|the old town]]. }}
==Eat==
* {{eat | name=Pastéis de Belém | address=Rua de Belém 84 | lat=38.6975 | long=-9.2033 | url= | content=Famous custard tarts. }}
* {{sleep | name=Some Hotel | content=Not an idea. }}
* {{see | name= | content=No name, skipped. }}
`

describe('Wikivoyage listings', () => {
  it('reads sights, things to do and food, with their place, hours, price and photo', () => {
    const l = parseListings(LISBON, 'Lisbon')
    expect(l.map((x) => [x.type, x.name])).toEqual([
      ['see', 'Jerónimos Monastery'],
      ['do', 'Tram 28'],
      ['eat', 'Pastéis de Belém'],
    ])
    expect(l[0]).toMatchObject({
      key: 'lisbon|see|jerónimos monastery',
      alt: 'Mosteiro dos Jerónimos',
      url: 'https://www.mosteirojeronimos.gov.pt/',
      address: 'Praça do Império',
      lat: 38.6979,
      lng: -9.2065,
      hours: 'Tu-Su 09:30-18:00',
      price: '€12',
      image: 'Jeronimos_monastery.jpg',
      content: 'A UNESCO World Heritage site built in the 1 km Manueline style. Arrive early.',
      page: 'Lisbon',
    })
    expect(l[1]!.content).toBe('The classic yellow tram through the old town.')
    expect(l[2]).toMatchObject({ url: null, lat: 38.6975 })
  })

  it('turns wiki markup into plain text', () => {
    expect(wikiText("[[Porto|the city]] and [https://example.com a site] ''nice'' &amp; <b>bold</b>")).toBe('the city and a site nice & bold')
    expect(guideUrl('Lisbon/Belém')).toBe('https://en.wikivoyage.org/wiki/Lisbon/Bel%C3%A9m')
  })

  it('finds the guide by name, falling back to search, and reads its district pages', async () => {
    const calls: URL[] = []
    const f = router(
      {
        'en.wikivoyage.org': (u) => {
          const p = Object.fromEntries(u.searchParams)
          if (p.titles === 'Lisbon') return json({ query: { pages: [{ title: 'Lisbon' }] } })
          if (p.titles === 'Cancun') return json({ query: { pages: [{ title: 'Cancun', missing: true }] } })
          if (p.list === 'search') return json({ query: { search: [{ title: 'Cancún' }] } })
          if (p.list === 'allpages') return json({ query: { allpages: [{ title: 'Lisbon/Belém' }, { title: 'Lisbon/Gallery' }] } })
          if (p.prop === 'revisions') {
            expect(p.titles).toBe('Lisbon|Lisbon/Belém')
            return json({ query: { pages: [{ title: 'Lisbon/Belém', revisions: [{ slots: { main: { content: '{{see|name=Belém Tower}}' } } }] }, { title: 'Lisbon', revisions: [{ slots: { main: { content: LISBON } } }] }] } })
          }
          return null
        },
      },
      calls,
    )
    expect(await findGuide('Lisbon', f)).toEqual({ title: 'Lisbon', requests: 1 })
    expect(await findGuide('Cancun', f)).toEqual({ title: 'Cancún', requests: 2 })
    const g = await guidePages('Lisbon', f)
    expect(g.pages.map((p) => p.title)).toEqual(['Lisbon', 'Lisbon/Belém'])
    expect(calls.every((c) => c.searchParams.get('format') === 'json')).toBe(true)
  })
})

describe('TikTok links', () => {
  it('recognise TikTok links and pull them out of shared text', () => {
    expect(isTikTokLink('https://vm.tiktok.com/ZMabc123/')).toBe(true)
    expect(isTikTokLink('https://www.tiktok.com/@travel/video/7301234567890123456')).toBe(true)
    expect(isTikTokLink('https://tiktok.com.evil.example/x')).toBe(false)
    expect(isTikTokLink('http://www.tiktok.com/@a/video/1234567890')).toBe(false)
    expect(findTikTokLink('Look at this! https://vm.tiktok.com/ZMabc123/ so pretty')).toBe('https://vm.tiktok.com/ZMabc123/')
    expect(findTikTokLink('https://example.com nothing here')).toBeNull()
    expect(tikTokVideoId('https://www.tiktok.com/@travel/video/7301234567890123456?is_from_webapp=1')).toBe('7301234567890123456')
  })

  it('follow short links only through TikTok', async () => {
    const full = 'https://www.tiktok.com/@lisbonfood/video/7301234567890123456?_r=1'
    const ok = router({ 'vm.tiktok.com': () => new Response(null, { status: 301, headers: { location: full } }) })
    expect(await expandTikTokLink('https://vm.tiktok.com/ZMabc/', ok)).toBe('https://www.tiktok.com/@lisbonfood/video/7301234567890123456')
    const evil = router({ 'vm.tiktok.com': () => new Response(null, { status: 301, headers: { location: 'https://evil.example/video/7301234567890123456' } }) })
    expect(await expandTikTokLink('https://vm.tiktok.com/ZMabc/', evil)).toBeNull()
  })

  it('read the caption and creator from the embed info', async () => {
    const f = router({
      'www.tiktok.com': (u) => {
        expect(u.pathname).toBe('/oembed')
        return json({ title: '📍Pastéis de Belém, Lisbon\nbest custard tarts #lisbon', author_name: 'Lisbon Food', author_unique_id: 'lisbonfood', author_url: 'https://www.tiktok.com/@lisbonfood', html: '<blockquote data-video-id="7301234567890123456"></blockquote>' })
      },
    })
    expect(await tikTokInfo('https://www.tiktok.com/@lisbonfood/video/7301234567890123456', f)).toEqual({
      url: 'https://www.tiktok.com/@lisbonfood/video/7301234567890123456',
      videoId: '7301234567890123456',
      caption: '📍Pastéis de Belém, Lisbon\nbest custard tarts #lisbon',
      author: 'lisbonfood',
      authorUrl: 'https://www.tiktok.com/@lisbonfood',
    })
    expect(await tikTokInfo('https://www.tiktok.com/@x/video/1234567890', router({ 'www.tiktok.com': () => new Response('{}', { status: 400 }) }))).toBeNull()
  })

  it('find the place a caption names, without guessing when it names none', () => {
    expect(placesInCaption('📍Pastéis de Belém, Lisbon\nbest custard tarts #lisbon')).toEqual(['Pastéis de Belém, Lisbon'])
    expect(placesInCaption('Location: Miradouro da Senhora do Monte 🌅 #views')[0]).toBe('Miradouro da Senhora do Monte')
    expect(placesInCaption('sunset at Ponte Luís I tonight')).toEqual(['Ponte Luís I'])
    expect(placesInCaption('so good 😍 #foodie #travel')).toEqual([])
  })
})
