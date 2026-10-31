/**
 * Open-Meteo weather (free for non-commercial use, no key). The forecast
 * covers the next 16 days; for later dates the archive gives what the
 * weather actually was on the same dates in past years.
 */
import { z } from 'zod'

export const OPEN_METEO_FORECAST = 'https://api.open-meteo.com/v1/forecast'
export const OPEN_METEO_ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive'
/** How far ahead the forecast goes. */
export const FORECAST_DAYS = 16

const nums = z.array(z.number().nullable())
const dailySchema = z.object({
  daily: z.object({
    time: z.array(z.string()),
    weather_code: nums.optional(),
    temperature_2m_max: nums.optional(),
    temperature_2m_min: nums.optional(),
    precipitation_sum: nums.optional(),
    precipitation_probability_max: nums.optional(),
  }),
})

export interface DailyWeather {
  date: string
  code: number | null
  /** °F */
  hi: number | null
  lo: number | null
  /** Inches. */
  rain: number | null
  /** Chance of rain in % (forecast only). */
  rainChance: number | null
}

async function daily(base: string, params: Record<string, string>, fetchImpl: typeof fetch): Promise<DailyWeather[]> {
  const qs = new URLSearchParams({ temperature_unit: 'fahrenheit', precipitation_unit: 'inch', timezone: 'auto', ...params })
  const res = await fetchImpl(`${base}?${qs}`, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`Open-Meteo responded ${res.status}`)
  const d = dailySchema.parse(await res.json()).daily
  return d.time.map((date, i) => ({
    date,
    code: d.weather_code?.[i] ?? null,
    hi: d.temperature_2m_max?.[i] ?? null,
    lo: d.temperature_2m_min?.[i] ?? null,
    rain: d.precipitation_sum?.[i] ?? null,
    rainChance: d.precipitation_probability_max?.[i] ?? null,
  }))
}

const at = (lat: number, lng: number) => ({ latitude: lat.toFixed(3), longitude: lng.toFixed(3) })

/** Daily forecast for dates within the next 16 days. */
export function forecastDaily(lat: number, lng: number, start: string, end: string, fetchImpl: typeof fetch = fetch): Promise<DailyWeather[]> {
  return daily(
    OPEN_METEO_FORECAST,
    { ...at(lat, lng), start_date: start, end_date: end, daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max' },
    fetchImpl,
  )
}

/** What the weather was each day between two past dates. */
export function pastDaily(lat: number, lng: number, start: string, end: string, fetchImpl: typeof fetch = fetch): Promise<DailyWeather[]> {
  return daily(OPEN_METEO_ARCHIVE, { ...at(lat, lng), start_date: start, end_date: end, daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum' }, fetchImpl)
}

/** Plain words for a WMO weather code. */
export function weatherLabel(code: number | null): string {
  if (code == null) return 'Unknown'
  if (code === 0) return 'Sunny'
  if (code <= 2) return 'Partly cloudy'
  if (code === 3) return 'Cloudy'
  if (code === 45 || code === 48) return 'Fog'
  if (code >= 51 && code <= 57) return 'Drizzle'
  if (code >= 61 && code <= 67) return 'Rain'
  if (code >= 71 && code <= 77) return 'Snow'
  if (code >= 80 && code <= 82) return 'Showers'
  if (code === 85 || code === 86) return 'Snow showers'
  if (code >= 95) return 'Thunderstorms'
  return 'Mixed'
}
