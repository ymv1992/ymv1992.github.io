/**
 * Which city a trip is in on each day, worked out from its plans: where you
 * check in (a stay covers its nights), else where most of the day's plans
 * are, else where a flight lands, else the city of the day before. Used for
 * the map by city, the weather and the packing list.
 */
import { getAirport } from '../geo/airports'
import type { TripDayView, TripItemView } from './shared'

type Item = Pick<TripItemView, 'id' | 'day' | 'position' | 'kind' | 'title' | 'time' | 'lat' | 'lng' | 'city' | 'countryCode' | 'booking' | 'place'>

export interface CityStop {
  key: string
  city: string
  countryCode: string | null
  /** The middle of the trip's places in this city (or the airport, when only a flight goes there). */
  lat: number
  lng: number
  /** Items with a pin in this city, by day then order. */
  itemIds: string[]
  firstDay: number | null
}

export interface DayCity {
  day: number
  date: string | null
  /** Key into the trip's city list; null when nothing says where the day is. */
  cityKey: string | null
  source: 'stay' | 'plans' | 'flight' | 'before' | 'after' | null
}

const keyOf = (city: string, cc: string | null) => `${city.toLowerCase()}|${(cc ?? '').toLowerCase()}`

function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = (d: number) => (d * Math.PI) / 180
  const h = Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLng - aLng) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

const order = (a: Item, b: Item) => (a.day ?? 999) - (b.day ?? 999) || a.position - b.position

export function tripCityPlan(days: readonly TripDayView[], items: readonly Item[]): { cities: CityStop[]; days: DayCity[] } {
  const cities = new Map<string, CityStop & { sumLat: number; sumLng: number; n: number }>()
  for (const i of [...items].sort(order)) {
    if (i.lat == null || i.lng == null || !i.city) continue
    const key = keyOf(i.city, i.countryCode)
    const c = cities.get(key) ?? { key, city: i.city, countryCode: i.countryCode, lat: 0, lng: 0, itemIds: [], firstDay: null, sumLat: 0, sumLng: 0, n: 0 }
    c.itemIds.push(i.id)
    c.sumLat += i.lat
    c.sumLng += i.lng
    c.n++
    if (i.day != null && (c.firstDay == null || i.day < c.firstDay)) c.firstDay = i.day
    cities.set(key, c)
  }
  for (const c of cities.values()) {
    c.lat = c.sumLat / c.n
    c.lng = c.sumLng / c.n
  }

  // A flight's arrival airport counts as the city it serves: a city already on the trip within 60 km, or the airport's own city.
  const arrival = (i: Item): string | null => {
    const a = i.kind === 'flight' ? getAirport(i.booking?.to) : null
    if (!a) return null
    const near = [...cities.values()].map((c) => ({ c, km: distanceKm(a.lat, a.lon, c.lat, c.lng) })).sort((x, y) => x.km - y.km)[0]
    if (near && near.km <= 60) return near.c.key
    const key = keyOf(a.city, a.countryCode)
    if (!cities.has(key)) cities.set(key, { key, city: a.city, countryCode: a.countryCode, lat: a.lat, lng: a.lon, itemIds: [], firstDay: i.day, sumLat: a.lat, sumLng: a.lon, n: 1 })
    return key
  }

  const stays = new Map<number, string>()
  for (const i of items) {
    if (i.kind !== 'hotel' || i.day == null || !i.city || i.lat == null) continue
    const nights = i.booking?.nights ?? 1
    for (let d = i.day; d < i.day + nights; d++) if (!stays.has(d)) stays.set(d, keyOf(i.city, i.countryCode))
  }

  const plan: DayCity[] = days.map((d) => {
    if (stays.has(d.day)) return { day: d.day, date: d.date, cityKey: stays.get(d.day)!, source: 'stay' }
    const todays = items.filter((i) => i.day === d.day).sort(order)
    const counts = new Map<string, number>()
    for (const i of todays) if (i.kind !== 'flight' && i.city && i.lat != null) counts.set(keyOf(i.city, i.countryCode), (counts.get(keyOf(i.city, i.countryCode)) ?? 0) + 1)
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
    if (top) return { day: d.day, date: d.date, cityKey: top[0], source: 'plans' }
    const landed = todays.filter((i) => i.kind === 'flight').map(arrival).filter((k): k is string => !!k).at(-1)
    if (landed) return { day: d.day, date: d.date, cityKey: landed, source: 'flight' }
    return { day: d.day, date: d.date, cityKey: null, source: null }
  })
  // Fill the gaps: the city of the day before, or for the first days, the first city the trip reaches.
  for (let i = 1; i < plan.length; i++) if (!plan[i]!.cityKey && plan[i - 1]!.cityKey) plan[i] = { ...plan[i]!, cityKey: plan[i - 1]!.cityKey, source: 'before' }
  const first = plan.find((p) => p.cityKey)?.cityKey ?? null
  for (const p of plan) {
    if (p.cityKey) break
    if (first) Object.assign(p, { cityKey: first, source: 'after' })
  }

  const list = [...cities.values()]
    .map(({ sumLat: _a, sumLng: _b, n: _n, ...c }) => c)
    .sort((a, b) => (a.firstDay ?? 999) - (b.firstDay ?? 999) || a.city.localeCompare(b.city))
  return { cities: list, days: plan }
}
