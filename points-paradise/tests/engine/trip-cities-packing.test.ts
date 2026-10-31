/** Which city each trip day is in, and packing suggestions from days, weather and plans (TEST FIXTURES). */
import { describe, expect, it } from 'vitest'
import { tripCityPlan } from '@/lib/trips/cities'
import { suggestPacking } from '@/lib/trips/packing'
import type { TripDayView, TripItemView } from '@/lib/trips/shared'

const days: TripDayView[] = Array.from({ length: 6 }, (_, i) => ({ day: i + 1, date: `2026-12-0${i + 4}` }))
let n = 0
const it_ = (p: Partial<TripItemView>): TripItemView => ({
  id: `i${++n}`,
  day: null,
  position: n,
  kind: 'activity',
  title: 'Thing',
  time: null,
  place: null,
  url: null,
  costAmount: null,
  costCurrency: 'USD',
  points: null,
  notes: null,
  done: false,
  dealId: null,
  lat: null,
  lng: null,
  mapSpan: null,
  photo: null,
  booking: null,
  city: null,
  countryCode: null,
  ...p,
})
const lisbon = { city: 'Lisbon', countryCode: 'PT', lat: 38.71, lng: -9.14 }
const porto = { city: 'Porto', countryCode: 'PT', lat: 41.15, lng: -8.61 }

describe('trip cities', () => {
  it('follow stays for their nights, then plans, then the day before', () => {
    const items = [
      it_({ kind: 'flight', day: 1, booking: { from: 'JFK', to: 'LIS' } }),
      it_({ kind: 'hotel', day: 1, title: 'Hotel in Lisbon', booking: { nights: 3 }, ...lisbon }),
      it_({ day: 2, title: 'Belém', ...lisbon, lat: 38.69 }),
      it_({ day: 4, title: 'Livraria Lello', ...porto }),
      it_({ day: 4, title: 'Ribeira', ...porto, lat: 41.14 }),
      it_({ day: null, title: 'Idea in Porto', ...porto }),
    ]
    const plan = tripCityPlan(days, items)
    expect(plan.cities.map((c) => [c.city, c.itemIds.length, c.firstDay])).toEqual([
      ['Lisbon', 2, 1],
      ['Porto', 3, 4],
    ])
    expect(plan.days.map((d) => [d.day, d.cityKey?.split('|')[0], d.source])).toEqual([
      [1, 'lisbon', 'stay'],
      [2, 'lisbon', 'stay'],
      [3, 'lisbon', 'stay'],
      [4, 'porto', 'plans'],
      [5, 'porto', 'before'],
      [6, 'porto', 'before'],
    ])
  })

  it('use where a flight lands when a day has nothing else, matching a city already on the trip', () => {
    const items = [it_({ kind: 'flight', day: 1, booking: { from: 'LAX', to: 'OPO' } }), it_({ day: 3, title: 'Ribeira', ...porto })]
    const plan = tripCityPlan(days.slice(0, 3), items)
    // Porto airport is about 11 km from the city's pins, so it counts as Porto.
    expect(plan.days.map((d) => [d.cityKey?.split('|')[0], d.source])).toEqual([
      ['porto', 'flight'],
      ['porto', 'before'],
      ['porto', 'plans'],
    ])
    expect(plan.cities).toHaveLength(1)
  })

  it('start from the first city reached, and say nothing when no day has a place', () => {
    const plan = tripCityPlan(days.slice(0, 3), [it_({ day: 3, title: 'Belém', ...lisbon })])
    expect(plan.days.map((d) => d.source)).toEqual(['after', 'after', 'plans'])
    expect(tripCityPlan(days.slice(0, 2), [it_({ day: 1, title: 'Somewhere' })]).days.map((d) => d.cityKey)).toEqual([null, null])
  })
})

describe('packing suggestions', () => {
  const base = { days: 5, weather: [], items: [], abroad: [], currency: null }
  const labels = (p: Parameters<typeof suggestPacking>[0]) => suggestPacking(p).map((s) => s.label)

  it('always cover the basics, with clothes for the number of days', () => {
    const l = labels(base)
    expect(l).toEqual(expect.arrayContaining(['ID or driver’s license', 'Tops × 5', 'Underwear × 6', 'Phone charger', 'Medications you take']))
    expect(l).not.toContain('Passport')
    const long = suggestPacking({ ...base, days: 12 })
    expect(long.find((s) => s.label === 'Tops × 7')?.reason).toBe('12 days (plan one laundry stop)')
  })

  it('add a passport, adapter and local cash abroad, and flight items when there are flights', () => {
    const s = suggestPacking({ ...base, abroad: ['PT'], currency: 'EUR', items: [{ kind: 'flight', title: 'Fly to Lisbon' }] })
    expect(s.find((x) => x.label === 'Passport')?.reason).toMatch(/PT.*6 months/)
    expect(s.map((x) => x.label)).toEqual(expect.arrayContaining(['Power adapter (check the plug type)', 'Some EUR cash', 'Boarding passes (in the airline app)', 'Liquids in 3.4 oz / 100 ml bottles']))
  })

  it('follow the weather in each city, saying which day and whether it is a forecast', () => {
    const s = suggestPacking({
      ...base,
      weather: [
        { day: 1, city: 'Lisbon', kind: 'forecast', hi: 64, lo: 50, rainChance: 70 },
        { day: 4, city: 'Porto', kind: 'typical', hi: 58, lo: 38, rainChance: 33 },
      ],
    })
    const why = (label: string) => s.find((x) => x.label === label)?.reason
    expect(why('Compact umbrella or rain jacket')).toBe('70% chance of rain in Lisbon on Day 1')
    // The coldest city on the trip gives the reason.
    expect(why('Light jacket or sweater')).toBe('Lows around 38°F in Porto (typical for these dates)')
    expect(why('Warm coat')).toBe('Lows near 38°F in Porto (typical for these dates)')
    expect(why('Sunscreen')).toBeUndefined()
    expect(labels({ ...base, weather: [{ day: 1, city: 'Cancún', kind: 'forecast', hi: 88, lo: 75, rainChance: 10 }] })).toEqual(expect.arrayContaining(['Sunscreen', 'Light, breathable clothes']))
  })

  it('pick up what is planned: beach and snorkeling, hikes, temples and nice dinners', () => {
    const s = suggestPacking({
      ...base,
      items: [
        { kind: 'activity', title: 'Snorkel at the cenote' },
        { kind: 'activity', title: 'Sunrise hike up the crater' },
        { kind: 'food', title: 'Dinner at a rooftop', notes: null },
        { kind: 'activity', title: 'Sé Cathedral' },
      ],
    })
    const why = (label: string) => s.find((x) => x.label === label)?.reason
    expect(why('Swimsuit')).toBe('For “Snorkel at the cenote”')
    expect(why('Reef-safe sunscreen')).toBe('For “Snorkel at the cenote”')
    expect(why('Hiking or trail shoes')).toBe('For “Sunrise hike up the crater”')
    expect(why('One dressy outfit')).toBe('For “Dinner at a rooftop”')
    expect(why('Clothes that cover shoulders and knees')).toBe('For “Sé Cathedral”')
  })
})
