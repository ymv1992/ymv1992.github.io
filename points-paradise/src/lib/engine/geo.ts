import type { Region } from '../domain/constants'

const CARIBBEAN = new Set('AG AI AW BB BL BQ BS CU CW DM DO GD GP HT JM KN KY LC MF MQ MS PR SX TC TT VC VG VI'.split(' '))
const CENTRAL_AMERICA = new Set('MX BZ CR GT HN NI PA SV'.split(' '))
const MIDDLE_EAST = new Set('AE BH IL IQ IR JO KW LB OM PS QA SA SY YE'.split(' '))
const INDIAN_OCEAN = new Set('MV SC MU RE YT KM'.split(' '))
const SOUTH_PACIFIC = new Set('PF FJ CK WS TO VU NC SB KI TV NU WF AS PW FM MH GU MP PG'.split(' '))
const OCEANIA = new Set(['AU', 'NZ'])

/** Travel region for an ISO country code, using its continent as a fallback. */
export function regionForCountry(countryCode: string, continent?: string | null): Region {
  const cc = countryCode.toUpperCase()
  if (CARIBBEAN.has(cc)) return 'caribbean'
  if (CENTRAL_AMERICA.has(cc)) return 'mexico_central_america'
  if (MIDDLE_EAST.has(cc)) return 'middle_east'
  if (INDIAN_OCEAN.has(cc)) return 'indian_ocean'
  if (SOUTH_PACIFIC.has(cc)) return 'south_pacific'
  if (OCEANIA.has(cc)) return 'oceania'
  if (cc === 'TR') return 'europe'
  switch (continent) {
    case 'EU':
      return 'europe'
    case 'AS':
      return 'asia'
    case 'AF':
      return 'africa'
    case 'SA':
      return 'south_america'
    case 'OC':
      return 'south_pacific'
    case 'AN':
      return 'antarctica'
    default:
      return 'north_america'
  }
}

const EARTH_RADIUS_KM = 6371

/** Great-circle distance in kilometres. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)))
}

/**
 * Rough nonstop block time estimate from distance. Used only when a real
 * schedule is unknown and always labelled as an estimate in the UI.
 */
export function estimateFlightMinutes(distanceKm: number): number {
  return Math.round(30 + (distanceKm / 820) * 60)
}

export const LONG_HAUL_MINUTES = 8 * 60
