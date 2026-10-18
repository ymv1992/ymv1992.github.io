/**
 * Builds src/data/airports.json and src/data/countries.json from public datasets.
 *
 *   OurAirports (public domain): https://github.com/davidmegginson/ourairports-data
 *     airports.csv, countries.csv
 *   mwgg/Airports (MIT): https://github.com/mwgg/Airports  airports.json (IANA timezones)
 *
 * Usage: npm run airports:build -- <dir containing airports.csv, countries.csv, mwgg.json>
 */
import fs from 'node:fs'
import path from 'node:path'

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (ch !== '\r') field += ch
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function toObjects(text: string): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text)
  if (!header) return []
  return rows.filter((r) => r.length === header.length).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
}

const dir = process.argv[2]
if (!dir) {
  console.error('Usage: npm run airports:build -- <data dir>')
  process.exit(1)
}

const airportsCsv = toObjects(fs.readFileSync(path.join(dir, 'airports.csv'), 'utf8'))
const countriesCsv = toObjects(fs.readFileSync(path.join(dir, 'countries.csv'), 'utf8'))
const mwgg = JSON.parse(fs.readFileSync(path.join(dir, 'mwgg.json'), 'utf8')) as Record<
  string,
  { icao: string; iata: string; tz: string }
>

const tzByIcao = new Map<string, string>()
const tzByIata = new Map<string, string>()
for (const a of Object.values(mwgg)) {
  if (a.tz) {
    if (a.icao) tzByIcao.set(a.icao, a.tz)
    if (a.iata) tzByIata.set(a.iata, a.tz)
  }
}

type AirportRow = [iata: string, name: string, city: string, country: string, lat: number, lon: number, tz: string, size: 'L' | 'M']
const out: AirportRow[] = []
const seen = new Set<string>()
for (const a of airportsCsv) {
  if (a.type !== 'large_airport' && a.type !== 'medium_airport') continue
  if (a.scheduled_service !== 'yes') continue
  const iata = a.iata_code?.trim()
  if (!iata || !/^[A-Z]{3}$/.test(iata) || seen.has(iata)) continue
  seen.add(iata)
  const tz = tzByIcao.get(a.icao_code || a.ident || '') ?? tzByIata.get(iata) ?? ''
  out.push([
    iata,
    a.name ?? '',
    a.municipality ?? '',
    a.iso_country ?? '',
    Math.round(Number(a.latitude_deg) * 10000) / 10000,
    Math.round(Number(a.longitude_deg) * 10000) / 10000,
    tz,
    a.type === 'large_airport' ? 'L' : 'M',
  ])
}
out.sort((x, y) => x[0].localeCompare(y[0]))

const countries = Object.fromEntries(
  countriesCsv.filter((c) => c.code).map((c) => [c.code, { name: c.name, continent: c.continent }]),
)

fs.writeFileSync(
  path.join('src/data/airports.json'),
  JSON.stringify({
    source: 'OurAirports (public domain) + mwgg/Airports timezones (MIT)',
    fields: ['iata', 'name', 'city', 'country', 'lat', 'lon', 'tz', 'size'],
    rows: out,
  }),
)
fs.writeFileSync(path.join('src/data/countries.json'), JSON.stringify(countries))
console.log(`Wrote ${out.length} airports and ${Object.keys(countries).length} countries`)
