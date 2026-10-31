import { eq } from 'drizzle-orm'
import type { AppDb } from '../db/client'
import { dataSources, placeLookups } from '../db/schema'
import { FORECAST_DAYS, forecastDaily, pastDaily, weatherLabel, type DailyWeather } from '../providers/open-meteo'
import type { CityStop, DayCity } from '../trips/cities'
import { logJob } from './usage'

export interface DayWeather {
  day: number
  date: string
  cityKey: string
  city: string
  /** A real forecast, or what the weather was on these dates in past years. */
  kind: 'forecast' | 'typical'
  /** °F */
  hi: number | null
  lo: number | null
  /** Forecast: chance of rain. Typical: share of past years it rained that day. Percent. */
  rainChance: number | null
  label: string
}

export interface TripWeather {
  days: DayWeather[]
  /** Cities whose weather couldn't be loaded right now. */
  unavailable: string[]
  /** How many past years "typical" days average. */
  years: number
}

const PAST_YEARS = 3
const FORECAST_TTL_H = 3
const PAST_TTL_H = 24 * 30
const RAINY_INCHES = 0.04

function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
}

/** The same calendar date `years` earlier (Feb 29 becomes Feb 28). */
function yearsBack(iso: string, years: number): string {
  const y = Number(iso.slice(0, 4)) - years
  const md = iso.slice(5) === '02-29' ? '02-28' : iso.slice(5)
  return `${y}-${md}`
}

async function cached(db: AppDb, key: string, ttlHours: number, now: Date, load: () => Promise<DailyWeather[]>): Promise<{ rows: DailyWeather[]; fetched: boolean }> {
  const [hit] = await db.select().from(placeLookups).where(eq(placeLookups.key, key))
  if (hit && now.getTime() - hit.fetchedAt.getTime() < ttlHours * 3_600_000) return { rows: hit.value as DailyWeather[], fetched: false }
  const rows = await load()
  await db.insert(placeLookups).values({ key, value: rows, fetchedAt: now }).onConflictDoUpdate({ target: placeLookups.key, set: { value: rows, fetchedAt: now } })
  return { rows, fetched: true }
}

function mostCommon<T>(list: T[]): T | null {
  const counts = new Map<T, number>()
  for (const v of list) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

const avg = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

/**
 * Weather for each upcoming trip day in the city the trip is in that day:
 * Open-Meteo's forecast within 16 days, otherwise the average of the same
 * dates over the past 3 years (labelled "typical"). Cached (forecasts for 3
 * hours, past years for 30 days); a city that fails is listed, never guessed.
 */
export async function tripWeather(db: AppDb, plan: { cities: CityStop[]; days: DayCity[] }, deps: { fetch: typeof fetch; now: Date }): Promise<TripWeather> {
  const today = deps.now.toISOString().slice(0, 10)
  const lastForecast = addDays(today, FORECAST_DAYS - 1)
  const [src] = await db.select({ enabled: dataSources.enabled }).from(dataSources).where(eq(dataSources.id, 'open_meteo'))
  const out: TripWeather = { days: [], unavailable: [], years: PAST_YEARS }
  if (src && !src.enabled) return out
  const cityByKey = new Map(plan.cities.map((c) => [c.key, c]))
  const byCity = new Map<string, DayCity[]>()
  for (const d of plan.days) {
    if (!d.date || !d.cityKey || d.date < today || !cityByKey.has(d.cityKey)) continue
    byCity.set(d.cityKey, [...(byCity.get(d.cityKey) ?? []), d])
  }
  let requests = 0
  const startedAt = new Date()
  for (const [key, days] of byCity) {
    const c = cityByKey.get(key)!
    const pos = `${c.lat.toFixed(2)}|${c.lng.toFixed(2)}`
    const soon = days.filter((d) => d.date! <= lastForecast)
    const later = days.filter((d) => d.date! > lastForecast)
    try {
      if (soon.length) {
        const start = soon[0]!.date!
        const end = soon.at(-1)!.date!
        const r = await cached(db, `wx|f|${pos}|${start}|${end}`, FORECAST_TTL_H, deps.now, () => forecastDaily(c.lat, c.lng, start, end, deps.fetch))
        if (r.fetched) requests++
        const byDate = new Map(r.rows.map((w) => [w.date, w]))
        for (const d of soon) {
          const w = byDate.get(d.date!)
          if (w) out.days.push({ day: d.day, date: d.date!, cityKey: key, city: c.city, kind: 'forecast', hi: w.hi, lo: w.lo, rainChance: w.rainChance, label: weatherLabel(w.code) })
        }
      }
      if (later.length) {
        const pasts: Map<string, DailyWeather>[] = []
        for (let y = 1; y <= PAST_YEARS; y++) {
          const start = yearsBack(later[0]!.date!, y)
          const end = yearsBack(later.at(-1)!.date!, y)
          const r = await cached(db, `wx|p|${pos}|${start}|${end}`, PAST_TTL_H, deps.now, () => pastDaily(c.lat, c.lng, start, end, deps.fetch))
          if (r.fetched) requests++
          pasts.push(new Map(r.rows.map((w) => [w.date, w])))
        }
        for (const d of later) {
          const seen = pasts.map((m, i) => m.get(yearsBack(d.date!, i + 1))).filter((w): w is DailyWeather => !!w)
          if (!seen.length) continue
          const rained = seen.filter((w) => (w.rain ?? 0) >= RAINY_INCHES).length
          out.days.push({
            day: d.day,
            date: d.date!,
            cityKey: key,
            city: c.city,
            kind: 'typical',
            hi: avg(seen.map((w) => w.hi)),
            lo: avg(seen.map((w) => w.lo)),
            rainChance: Math.round((rained / seen.length) * 100),
            label: weatherLabel(mostCommon(seen.map((w) => w.code))),
          })
        }
      }
    } catch (err) {
      out.unavailable.push(c.city)
      await logJob(db, { provider: 'open_meteo', jobType: 'trip_weather', params: { city: c.city }, status: 'failed', startedAt, requestCount: 1, error: err instanceof Error ? err.message : 'Weather failed' })
    }
  }
  if (requests) await logJob(db, { provider: 'open_meteo', jobType: 'trip_weather', params: { cities: byCity.size }, status: 'succeeded', startedAt, requestCount: requests, resultsCount: out.days.length })
  out.days.sort((a, b) => a.day - b.day)
  return out
}
