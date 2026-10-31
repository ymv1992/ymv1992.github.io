/**
 * Airlines that seats.aero shows for the Chase programs it covers (United,
 * Aeroplan, Flying Blue, Virgin Atlantic), and those programs' short labels.
 * Safe for browser components.
 */

export const AWARD_AIRLINES: readonly (readonly [code: string, name: string])[] = [
  ['A3', 'Aegean'],
  ['EI', 'Aer Lingus'],
  ['AM', 'Aeroméxico'],
  ['AC', 'Air Canada'],
  ['CA', 'Air China'],
  ['UX', 'Air Europa'],
  ['AF', 'Air France'],
  ['AI', 'Air India'],
  ['NZ', 'Air New Zealand'],
  ['NH', 'ANA'],
  ['OZ', 'Asiana'],
  ['OS', 'Austrian'],
  ['AV', 'Avianca'],
  ['AD', 'Azul'],
  ['SN', 'Brussels Airlines'],
  ['CI', 'China Airlines'],
  ['MU', 'China Eastern'],
  ['CM', 'Copa'],
  ['DL', 'Delta'],
  ['MS', 'EgyptAir'],
  ['EK', 'Emirates'],
  ['ET', 'Ethiopian'],
  ['EY', 'Etihad'],
  ['BR', 'EVA Air'],
  ['GA', 'Garuda Indonesia'],
  ['GF', 'Gulf Air'],
  ['AZ', 'ITA Airways'],
  ['KQ', 'Kenya Airways'],
  ['KL', 'KLM'],
  ['KE', 'Korean Air'],
  ['LO', 'LOT Polish'],
  ['LH', 'Lufthansa'],
  ['SK', 'SAS'],
  ['SV', 'Saudia'],
  ['ZH', 'Shenzhen Airlines'],
  ['SQ', 'Singapore Airlines'],
  ['SA', 'South African'],
  ['LX', 'Swiss'],
  ['TP', 'TAP Air Portugal'],
  ['TG', 'Thai'],
  ['TK', 'Turkish Airlines'],
  ['UA', 'United'],
  ['VN', 'Vietnam Airlines'],
  ['VS', 'Virgin Atlantic'],
]

const NAMES = new Map(AWARD_AIRLINES.map(([c, n]) => [c, n]))
export const AWARD_AIRLINE_CODES = AWARD_AIRLINES.map(([c]) => c) as [string, ...string[]]

/** Airline codes in a seats.aero airlines field ("UA, NH" → ["UA", "NH"]). */
export function airlineCodes(text: string | null | undefined): string[] {
  return (text ?? '').toUpperCase().split(/[^A-Z0-9]+/).filter((c) => /^[A-Z0-9]{2}$/.test(c))
}

/** "UA, NH" → "United, ANA"; unknown codes stay as codes, and text without codes is kept as is. */
export function airlineNames(text: string | null | undefined): string {
  const codes = airlineCodes(text)
  return codes.length ? [...new Set(codes)].map((c) => NAMES.get(c) ?? c).join(', ') : (text ?? '')
}

export function airlineName(code: string): string {
  return NAMES.get(code) ?? code
}

/** The Chase transfer partners seats.aero covers, as a search filter. */
export const AWARD_PROGRAMS = [
  { id: 'united', label: 'United MileagePlus', unit: 'United miles' },
  { id: 'aeroplan', label: 'Air Canada Aeroplan', unit: 'Aeroplan points' },
  { id: 'flying_blue', label: 'Air France-KLM Flying Blue', unit: 'Flying Blue miles' },
  { id: 'virgin_atlantic', label: 'Virgin Atlantic Flying Club', unit: 'Virgin points' },
] as const

export type AwardProgramId = (typeof AWARD_PROGRAMS)[number]['id']
export const AWARD_PROGRAM_IDS = AWARD_PROGRAMS.map((p) => p.id) as [AwardProgramId, ...AwardProgramId[]]

/** "United miles", "Aeroplan points"… for a result row; plain "miles" for anything else. */
export function programUnit(programId: string): string {
  return AWARD_PROGRAMS.find((p) => p.id === programId)?.unit ?? 'miles'
}
