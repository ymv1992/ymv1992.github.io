/** Trip weather (forecast or typical), its cache, and the packing list (TEST FIXTURES). */
import { beforeAll, describe, expect, it } from 'vitest'
import type { AppDb } from '@/lib/db/client'
import { ensureOwnerAccount } from '@/lib/data/account'
import { tripWeather } from '@/lib/data/trip-weather'
import { addOwnPackingItem, addSuggestions, listPacking, removePackingItem, setPacked } from '@/lib/data/trip-packing'
import { createTrip, tripInputSchema } from '@/lib/data/trips'
import { reverseCity } from '@/lib/providers/nominatim'
import type { CityStop, DayCity } from '@/lib/trips/cities'
import { NOW } from '../fixtures'
import { json, router } from '../place-fixtures'
import { createTestDb } from '../test-db'

let db: AppDb
let userId: string
let tripId: string

beforeAll(async () => {
  db = await createTestDb()
  userId = await ensureOwnerAccount(db, 'owner@example.com')
  tripId = await createTrip(db, userId, tripInputSchema.parse({ name: 'Portugal', destination: 'Portugal', startDate: '2026-10-20', endDate: '2026-10-22' }))
}, 60_000)

const city = (key: string, name: string, lat: number, lng: number): CityStop => ({ key, city: name, countryCode: 'PT', lat, lng, itemIds: [], firstDay: 1 })
const day = (d: number, date: string, cityKey: string | null): DayCity => ({ day: d, date, cityKey, source: 'plans' })

/** Open-Meteo answers: the forecast, and past years where it rained on Dec 4 two years in three. */
function meteo(calls: URL[]) {
  const daily = (dates: string[], hi: number, rain: (d: string) => number, chance?: number) =>
    json({
      daily: {
        time: dates,
        weather_code: dates.map(() => 3),
        temperature_2m_max: dates.map(() => hi),
        temperature_2m_min: dates.map(() => hi - 12),
        precipitation_sum: dates.map(rain),
        ...(chance != null ? { precipitation_probability_max: dates.map(() => chance) } : {}),
      },
    })
  const range = (u: URL) => {
    const out: string[] = []
    for (let t = Date.parse(`${u.searchParams.get('start_date')}T00:00:00Z`); t <= Date.parse(`${u.searchParams.get('end_date')}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10))
    return out
  }
  return router(
    {
      'api.open-meteo.com': (u) => daily(range(u), 68, () => 0, 55),
      'archive-api.open-meteo.com': (u) => {
        const year = Number(u.searchParams.get('start_date')!.slice(0, 4))
        return daily(range(u), 57 + (2025 - year) * 3, (d) => (d.endsWith('12-04') && year !== 2024 ? 0.3 : 0))
      },
    },
    calls,
  )
}

describe('trip weather', () => {
  const cities = [city('lisbon|pt', 'Lisbon', 38.72, -9.14), city('porto|pt', 'Porto', 41.15, -8.61)]

  it('uses the forecast within 16 days and the past 3 years after that, per city', async () => {
    const calls: URL[] = []
    const w = await tripWeather(db, { cities, days: [day(1, '2026-10-20', 'lisbon|pt'), day(2, '2026-10-21', 'lisbon|pt'), day(3, '2026-12-04', 'porto|pt'), day(4, '2026-12-05', 'porto|pt')] }, { fetch: meteo(calls), now: NOW })
    expect(w.days.map((d) => [d.day, d.city, d.kind, d.hi, d.rainChance])).toEqual([
      [1, 'Lisbon', 'forecast', 68, 55],
      [2, 'Lisbon', 'forecast', 68, 55],
      // Average of 57, 60 and 63 °F; rain on Dec 4 in 2025 and 2023 but not 2024.
      [3, 'Porto', 'typical', 60, 67],
      [4, 'Porto', 'typical', 60, 0],
    ])
    expect(w.days[0]!.label).toBe('Cloudy')
    expect(calls.map((c) => [c.hostname, c.searchParams.get('start_date'), c.searchParams.get('end_date')])).toEqual([
      ['api.open-meteo.com', '2026-10-20', '2026-10-21'],
      ['archive-api.open-meteo.com', '2025-12-04', '2025-12-05'],
      ['archive-api.open-meteo.com', '2024-12-04', '2024-12-05'],
      ['archive-api.open-meteo.com', '2023-12-04', '2023-12-05'],
    ])
    expect(calls[0]!.searchParams.get('temperature_unit')).toBe('fahrenheit')
    // Loaded again: everything comes from the cache.
    const again: URL[] = []
    await tripWeather(db, { cities, days: [day(1, '2026-10-20', 'lisbon|pt'), day(2, '2026-10-21', 'lisbon|pt'), day(3, '2026-12-04', 'porto|pt'), day(4, '2026-12-05', 'porto|pt')] }, { fetch: meteo(again), now: NOW })
    expect(again).toHaveLength(0)
  })

  it('skips past days and days with no city, and names a city whose weather failed instead of guessing', async () => {
    const down = router({ 'api.open-meteo.com': () => new Response('busy', { status: 503 }) })
    const w = await tripWeather(db, { cities: [city('faro|pt', 'Faro', 37.02, -7.93)], days: [day(1, '2026-10-01', 'faro|pt'), day(2, '2026-10-19', null), day(3, '2026-10-20', 'faro|pt')] }, { fetch: down, now: NOW })
    expect(w).toEqual({ days: [], unavailable: ['Faro'], years: 3 })
  })
})

describe('city lookup', () => {
  it('reads the town from OpenStreetMap, falling back from city to town to village', async () => {
    const f = (address: Record<string, string>) => router({ 'nominatim.openstreetmap.org': () => json({ address }) })
    expect(await reverseCity(41.15, -8.61, f({ city: 'Porto', country_code: 'pt' }))).toEqual({ city: 'Porto', countryCode: 'PT' })
    expect(await reverseCity(20.9, -156.3, f({ town: 'Paia', county: 'Maui County', country_code: 'us' }))).toEqual({ city: 'Paia', countryCode: 'US' })
    expect(await reverseCity(0, 0, router({ 'nominatim.openstreetmap.org': () => json({ error: 'Unable to geocode' }) }))).toBeNull()
  })
})

describe('packing list', () => {
  it('adds suggestions once, keeps what you removed removed, and keeps your own items', async () => {
    const s = [
      { label: 'Passport', category: 'documents' as const, reason: 'Travel abroad (PT)' },
      { label: 'Sunscreen', category: 'weather' as const, reason: 'Highs up to 84°F in Lisbon' },
    ]
    expect(await addSuggestions(db, userId, tripId, s)).toBe(2)
    expect(await addSuggestions(db, userId, tripId, s)).toBe(0)
    let list = await listPacking(db, userId, tripId)
    const sunscreen = list.find((i) => i.label === 'Sunscreen')!
    await removePackingItem(db, userId, sunscreen.id)
    expect(await addSuggestions(db, userId, tripId, s)).toBe(0)
    expect((await listPacking(db, userId, tripId)).map((i) => i.label)).toEqual(['Passport'])
    // A new reason (new weather) replaces the old one.
    await addSuggestions(db, userId, tripId, [{ ...s[0]!, reason: 'Travel abroad (PT, ES)' }])
    expect((await listPacking(db, userId, tripId))[0]!.reason).toBe('Travel abroad (PT, ES)')

    expect(await addOwnPackingItem(db, userId, tripId, '  Snorkel mask ')).toEqual({ ok: true })
    expect(await addOwnPackingItem(db, userId, tripId, '')).toEqual({ ok: false, error: 'Type what to pack' })
    list = await listPacking(db, userId, tripId)
    const mask = list.find((i) => i.label === 'Snorkel mask')!
    expect(mask).toMatchObject({ category: 'other', reason: null, packed: false })
    await setPacked(db, userId, mask.id, true)
    expect((await listPacking(db, userId, tripId)).find((i) => i.id === mask.id)?.packed).toBe(true)
    await removePackingItem(db, userId, mask.id)
    expect((await listPacking(db, userId, tripId)).map((i) => i.label)).toEqual(['Passport'])
  })

  it('belongs to the trip owner only', async () => {
    const other = await ensureOwnerAccount(db, 'other@example.com')
    expect(await listPacking(db, other, tripId)).toEqual([])
    expect(await addSuggestions(db, other, tripId, [{ label: 'X', category: 'other', reason: 'r' }])).toBe(0)
    const [passport] = await listPacking(db, userId, tripId)
    await setPacked(db, other, passport!.id, true)
    await removePackingItem(db, other, passport!.id)
    expect((await listPacking(db, userId, tripId))[0]).toMatchObject({ label: 'Passport', packed: false })
  })
})
