import airportsJson from '../../data/airports.json'
import countriesJson from '../../data/countries.json'
import type { Region } from '../domain/constants'
import { regionForCountry } from '../engine/geo'

export interface Airport {
  iata: string
  name: string
  city: string
  countryCode: string
  countryName: string
  lat: number
  lon: number
  tz: string | null
  large: boolean
  region: Region
}

type Row = [string, string, string, string, number, number, string, 'L' | 'M']
const countries = countriesJson as Record<string, { name: string; continent: string }>

let cache: Map<string, Airport> | null = null

function load(): Map<string, Airport> {
  if (cache) return cache
  const map = new Map<string, Airport>()
  for (const [iata, name, city, cc, lat, lon, tz, size] of (airportsJson as unknown as { rows: Row[] }).rows) {
    const c = countries[cc]
    map.set(iata, {
      iata,
      name,
      city,
      countryCode: cc,
      countryName: c?.name ?? cc,
      lat,
      lon,
      tz: tz || null,
      large: size === 'L',
      region: regionForCountry(cc, c?.continent),
    })
  }
  cache = map
  return map
}

export function getAirport(iata: string | null | undefined): Airport | null {
  if (!iata) return null
  return load().get(iata.trim().toUpperCase()) ?? null
}

export function countryName(code: string | null | undefined): string | null {
  if (!code) return null
  return countries[code.toUpperCase()]?.name ?? null
}

export function regionForCountryCode(code: string): Region {
  return regionForCountry(code, countries[code.toUpperCase()]?.continent)
}

export function allCountries(): { code: string; name: string }[] {
  return Object.entries(countries)
    .map(([code, c]) => ({ code, name: c.name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Airport search by IATA code, city or name. Exact code matches first, then large airports. */
export function searchAirports(query: string, limit = 10): Airport[] {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []
  const out: { a: Airport; score: number }[] = []
  for (const a of load().values()) {
    let score = 0
    if (a.iata.toLowerCase() === q) score = 100
    else if (a.city.toLowerCase().startsWith(q)) score = 60
    else if (a.name.toLowerCase().includes(q)) score = 40
    else if (a.city.toLowerCase().includes(q) || a.countryName.toLowerCase().startsWith(q)) score = 30
    if (score > 0) out.push({ a, score: score + (a.large ? 5 : 0) })
  }
  return out
    .sort((x, y) => y.score - x.score || x.a.iata.localeCompare(y.a.iata))
    .slice(0, limit)
    .map((x) => x.a)
}
