/**
 * Adapter tests use small TEST FIXTURES shaped like documented provider
 * responses. No network calls are made; these are not real fares or awards.
 */
import { describe, expect, it } from 'vitest'
import { cachedSearch, itemToDealColumns, searchDiagnostics } from '@/lib/providers/seats-aero'
import { searchFlightPrice, searchHotelRate } from '@/lib/providers/serpapi'
import { matchKeywords, parseFeed } from '@/lib/providers/rss'
import { searchDestinationPhoto } from '@/lib/providers/unsplash'
import { dealDedupeKey } from '@/lib/data/deal-input'

function fakeFetch(body: unknown, status = 200, capture?: (url: string, init?: RequestInit) => void): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    capture?.(String(url), init)
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
  }) as typeof fetch
}

const seatsFixture = {
  data: [
    {
      ID: 'fixture-1',
      Route: { OriginAirport: 'LAX', DestinationAirport: 'HND', Distance: 5470, Source: 'aeroplan' },
      Date: '2026-12-01',
      Source: 'aeroplan',
      JAvailable: true,
      JMileageCost: '75000',
      JMileageCostRaw: 75000,
      JTotalTaxes: 5610,
      TaxesCurrency: 'USD',
      JAirlines: 'NH',
      JDirect: true,
      YAvailable: false,
      UpdatedAt: '2026-10-18T08:00:00Z',
    },
    { ID: 'fixture-2', Route: { OriginAirport: 'LAX', DestinationAirport: 'HND' }, Date: '2026-12-02', Source: 'qantas', JAvailable: true, JMileageCostRaw: 90000 },
    { ID: 'fixture-3', Route: { OriginAirport: 'LAX', DestinationAirport: 'HND' }, Date: '2026-12-03', Source: 'united', JAvailable: false },
    { broken: true },
  ],
  count: 4,
  hasMore: false,
}

describe('seats.aero adapter', () => {
  it('sends the documented header and parameters', async () => {
    let seenUrl = ''
    let seenInit: RequestInit | undefined
    const r = await cachedSearch('key-123', { origins: ['LAX', 'SFO'], destinations: ['HND'], cabin: 'business', startDate: '2026-12-01', endDate: '2026-12-31' }, fakeFetch(seatsFixture, 200, (u, i) => {
      seenUrl = u
      seenInit = i
    }))
    expect(seenUrl).toContain('https://seats.aero/partnerapi/search?')
    expect(seenUrl).toContain('origin_airport=LAX%2CSFO')
    expect(seenUrl).toContain('cabin=business')
    expect((seenInit?.headers as Record<string, string>)['Partner-Authorization']).toBe('key-123')
    expect(r.items).toHaveLength(3)
    expect(r.skippedMalformed).toBe(1)
  })

  it('reads results whose empty fields are null, and explains unreadable ones', async () => {
    const body = {
      data: [
        {
          ID: 987,
          Route: { OriginAirport: 'LAX', DestinationAirport: 'NRT', Distance: null, Source: null },
          Date: '2026-12-05',
          Source: 'united',
          YAvailable: false,
          JAvailable: true,
          YMileageCost: null,
          JMileageCost: '70000',
          JMileageCostRaw: 70000,
          JTotalTaxes: 5600,
          TaxesCurrency: null,
          JAirlines: 'NH',
          JDirect: null,
          UpdatedAt: null,
        },
        { ID: 'broken', Date: '2026-12-06', Source: 'united' },
      ],
      count: 2,
      hasMore: false,
      cursor: null,
    }
    const r = await cachedSearch('k', { origins: ['LAX'], destinations: ['NRT'], cabin: 'business', startDate: '2026-12-01', endDate: '2026-12-31' }, fakeFetch(body))
    expect(r.items).toHaveLength(1)
    expect(itemToDealColumns(r.items[0]!, 'business')?.programPoints).toBe(70000)
    expect(searchDiagnostics(r)).toMatchObject({ returned: 2, unreadable: 1, sources: ['united'], firstIssue: expect.stringMatching(/^Route/) })
    expect(String(searchDiagnostics(r).sample)).toContain('broken')
  })

  it('maps available Chase-partner awards and skips the rest', async () => {
    const { items } = await cachedSearch('k', { origins: ['LAX'], destinations: ['HND'], cabin: 'business', startDate: '2026-12-01', endDate: '2026-12-31' }, fakeFetch(seatsFixture))
    const mapped = items.map((i) => itemToDealColumns(i, 'business'))
    expect(mapped[1]).toBeNull() // qantas is not a Chase partner
    expect(mapped[2]).toBeNull() // no business availability
    const d = mapped[0]!
    expect(d.programId).toBe('aeroplan')
    expect(d.programPoints).toBe(75000)
    expect(d.mandatoryCashUsd).toBeCloseTo(56.1)
    expect(d.comparableCashUsd).toBeNull()
    expect(d.verifiedAt?.toISOString()).toBe('2026-10-18T08:00:00.000Z')
    expect(d.flight?.stops).toBe(0)
    expect(d.missingInfo).toContain('Comparable cash price')
    // Same natural key as a manual entry of the same award, so they merge.
    expect(d.dedupeKey).toBe(
      dealDedupeKey({ kind: 'flight', programId: 'aeroplan', originAirport: 'LAX', destAirport: 'HND', destCity: 'Tokyo', travelStart: '2026-12-01', travelEnd: null, cabin: 'business', flightNumbers: [], property: null, roomType: null }),
    )
  })

  it('throws on HTTP errors so the job is logged as failed', async () => {
    await expect(cachedSearch('k', { origins: ['LAX'], destinations: ['HND'], cabin: 'business', startDate: 'a', endDate: 'b' }, fakeFetch({}, 429))).rejects.toThrow(/429/)
  })
})

describe('SerpApi adapters', () => {
  const flights = {
    best_flights: [
      { price: 4100, total_duration: 690, flights: [{ airline: 'Example Air', flight_number: 'EX 1', airplane: 'Boeing 787', travel_class: 'Business', extensions: ['Lie flat seat'] }] },
      { price: 3200, total_duration: 900, flights: [{ travel_class: 'Business' }, { travel_class: 'Economy' }] },
    ],
    other_flights: [{ price: 3900, total_duration: 800, flights: [{ travel_class: 'Business' }, { travel_class: 'Business' }] }],
  }
  it('picks the cheapest all-business itinerary within the stop limit', async () => {
    const q = await searchFlightPrice('k', { from: 'LAX', to: 'HND', date: '2026-12-01', cabin: 'business', maxStops: 0 }, fakeFetch(flights))
    expect(q?.priceUsd).toBe(4100)
    expect(q?.seatType).toBe('lie_flat')
    expect(q?.cashProduct.cabin).toBe('business')
  })
  it('prefers fares entirely in the cabin over cheaper mixed-cabin ones', async () => {
    const q = await searchFlightPrice('k', { from: 'LAX', to: 'HND', date: '2026-12-01', cabin: 'business' }, fakeFetch(flights))
    expect(q?.priceUsd).toBe(3900)
    expect(q?.mixedCabin).toBe(false)
  })
  it('counts a connection whose long flight is in the cabin when nothing else matches', async () => {
    const connecting = {
      best_flights: [
        // Short hop in first is a higher cabin, so it could overstate the price: skipped.
        { price: 2600, flights: [{ travel_class: 'First', duration: 60 }, { travel_class: 'Business', duration: 660 }] },
        // Long flight in economy: not a business fare.
        { price: 1200, flights: [{ travel_class: 'Business', duration: 60 }, { travel_class: 'Economy', duration: 660 }] },
        { price: 3100, flights: [{ travel_class: 'Economy', duration: 65 }, { travel_class: 'Business', duration: 670 }] },
      ],
      other_flights: [{ price: 2900, flights: [{ travel_class: 'Economy' }, { travel_class: 'Business' }] }],
    }
    const q = await searchFlightPrice('k', { from: 'SAN', to: 'NRT', date: '2027-01-19', cabin: 'business', maxStops: 1 }, fakeFetch(connecting))
    expect(q?.priceUsd).toBe(3100)
    expect(q?.mixedCabin).toBe(true)
    expect(q?.cashProduct.mixedCabin).toBe(true)
  })
  it('treats "no results" from SerpApi as no fare rather than a failure', async () => {
    const empty = { error: "Google Flights hasn't returned any results for this query." }
    expect(await searchFlightPrice('k', { from: 'PSP', to: 'NRT', date: '2027-01-19', cabin: 'business' }, fakeFetch(empty))).toBeNull()
    expect(await searchHotelRate('k', { property: 'Example', checkIn: '2027-01-01', checkOut: '2027-01-03', adults: 2 }, fakeFetch(empty))).toBeNull()
    await expect(searchFlightPrice('k', { from: 'SAN', to: 'NRT', date: '2027-01-19', cabin: 'business' }, fakeFetch({ error: 'Invalid API key.' }))).rejects.toThrow(/Invalid API key/)
  })
  it('matches the named hotel and records a standard-room comparison', async () => {
    const body = { properties: [{ name: 'Other Hotel', total_rate: { extracted_lowest: 300 } }, { name: 'Example Resort & Spa', total_rate: { extracted_lowest: 4800 } }] }
    const r = await searchHotelRate('k', { property: 'Example Resort', checkIn: '2027-01-01', checkOut: '2027-01-05', adults: 2 }, fakeFetch(body))
    expect(r?.totalUsd).toBe(4800)
    expect(r?.cashProduct.roomType).toBe('standard')
    expect(await searchHotelRate('k', { property: 'Missing', checkIn: 'a', checkOut: 'b', adults: 2 }, fakeFetch(body))).toBeNull()
  })
})

describe('RSS and photo adapters', () => {
  it('parses RSS and Atom, keeping only titles, links and dates', () => {
    const xml = `<rss><channel>
      <item><title><![CDATA[Chase Ultimate Rewards: 30% transfer bonus to Example Miles]]></title><link>https://example.com/a</link><pubDate>Fri, 16 Oct 2026 10:00:00 GMT</pubDate><description>long text</description></item>
      <item><title>Unrelated &amp; boring</title><link>javascript:alert(1)</link></item>
    </channel></rss>
    <feed><entry><title>Amex news</title><link href="https://example.com/b"/><updated>2026-10-17T00:00:00Z</updated></entry></feed>`
    const items = parseFeed(xml)
    expect(items).toHaveLength(2)
    expect(items[0]!.title).toBe('Chase Ultimate Rewards: 30% transfer bonus to Example Miles')
    expect(items[0]!.publishedAt?.toISOString()).toBe('2026-10-16T10:00:00.000Z')
    expect(matchKeywords(items[0]!.title)).toEqual(['chase', 'transfer bonus'])
    expect(matchKeywords(items[1]!.title)).toBeNull()
  })
  it('credits the photographer', async () => {
    const p = await searchDestinationPhoto('k', 'Kyoto', fakeFetch({ results: [{ urls: { regular: 'https://images.example.com/x.jpg' }, user: { name: 'A. Photographer', links: { html: 'https://unsplash.com/@a' } } }] }))
    expect(p?.creditName).toBe('A. Photographer')
    expect(p?.creditUrl).toContain('utm_source=points_paradise')
  })
})
