import type { AppDb } from '../db/client'
import { getAirport } from '../geo/airports'
import { tripCityPlan, type CityStop, type DayCity } from '../trips/cities'
import type { PackingInput } from '../trips/packing'
import { toItemView, type TripDayView } from '../trips/shared'
import { tripWeather, type TripWeather } from './trip-weather'
import { tripDayCount, tripDayDate, type TripItemRow, type TripRow } from './trips'

export interface TripPlan {
  days: TripDayView[]
  cities: CityStop[]
  dayCities: DayCity[]
}

/** Which city each trip day is in, and the trip's cities with their pins. */
export function planTrip(trip: TripRow, items: readonly TripItemRow[]): TripPlan {
  const days: TripDayView[] = Array.from({ length: tripDayCount(trip) }, (_, i) => ({ day: i + 1, date: tripDayDate(trip, i + 1) }))
  const plan = tripCityPlan(
    days,
    items.map((i) => toItemView(i)),
  )
  return { days, cities: plan.cities, dayCities: plan.days }
}

/** Weather for the trip's upcoming days, or null for a trip without dates. */
export async function weatherForTrip(db: AppDb, trip: TripRow, plan: TripPlan, deps: { fetch: typeof fetch; now: Date }): Promise<TripWeather | null> {
  if (!trip.startDate) return null
  return tripWeather(db, { cities: plan.cities, days: plan.dayCities }, deps)
}

/** The owner's home country, from their first home airport (US when unknown). */
export function homeCountry(homeAirports: readonly string[]): string {
  return getAirport(homeAirports[0])?.countryCode ?? 'US'
}

export function packingInput(trip: TripRow, items: readonly TripItemRow[], plan: TripPlan, weather: TripWeather | null, home: string): PackingInput {
  const codes = new Set([...plan.cities.map((c) => c.countryCode), ...items.map((i) => i.countryCode)].filter((c): c is string => !!c && c !== home))
  return {
    days: plan.days.length,
    weather: weather?.days ?? [],
    items: items.map((i) => ({ kind: i.kind, title: i.title, notes: i.notes, place: i.place, countryCode: i.countryCode })),
    abroad: [...codes].sort(),
    currency: trip.currency && trip.currency !== 'USD' ? trip.currency : null,
  }
}
