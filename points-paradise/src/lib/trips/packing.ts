/**
 * Packing suggestions from the trip itself: how many days, the weather in
 * each city, what's planned (beach, hikes, temples, nice dinners), flights,
 * and whether it's abroad. Each suggestion says why it's there.
 */
import type { PackingCategory } from '../db/schema'
import type { DayWeather } from '../data/trip-weather'

export interface PackingSuggestion {
  label: string
  category: PackingCategory
  reason: string
}

export interface PackingInput {
  days: number
  weather: readonly Pick<DayWeather, 'day' | 'city' | 'kind' | 'hi' | 'lo' | 'rainChance'>[]
  items: readonly { kind: string; title: string; notes?: string | null; place?: string | null; countryCode?: string | null }[]
  /** Country codes the trip visits, other than home. */
  abroad: string[]
  /** The trip's local currency, if not dollars. */
  currency: string | null
}

export const PACKING_CATEGORY_LABEL: Record<PackingCategory, string> = {
  documents: 'Documents & money',
  clothes: 'Clothes',
  weather: 'For the weather',
  activities: 'For your plans',
  toiletries: 'Toiletries & health',
  tech: 'Phone & tech',
  other: 'Other',
}

export const PACKING_ORDER: PackingCategory[] = ['documents', 'clothes', 'weather', 'activities', 'toiletries', 'tech', 'other']

const ACTIVITIES: { match: RegExp; items: [string, string?][] }[] = [
  { match: /\b(beach|snorkel\w*|swim\w*|pool|cenotes?|boat|catamaran|surf\w*|island|lagoon|reef)\b/i, items: [['Swimsuit'], ['Flip-flops or water shoes'], ['Reef-safe sunscreen', 'reef|snorkel|cenote']] },
  { match: /\b(hik\w*|trails?|volcano|crater|summit|trek\w*|ruins|canyon|waterfall)\b/i, items: [['Hiking or trail shoes'], ['Day pack'], ['Refillable water bottle']] },
  { match: /\b(dinner|restaurant|rooftop|opera|theat(er|re)|show|michelin|tasting|gala|club)\b/i, items: [['One dressy outfit']] },
  { match: /\b(temples?|church|cathedral|mosque|basilica|monaster(y|ies)|shrine|vatican|sagrada)\b/i, items: [['Clothes that cover shoulders and knees']] },
  { match: /\b(ski\w*|snowboard\w*|glacier)\b/i, items: [['Thermal base layers'], ['Waterproof gloves']] },
]

const round = (n: number) => Math.round(n)

export function suggestPacking(p: PackingInput): PackingSuggestion[] {
  const out = new Map<string, PackingSuggestion>()
  const add = (label: string, category: PackingCategory, reason: string) => {
    if (!out.has(label.toLowerCase())) out.set(label.toLowerCase(), { label, category, reason })
  }
  const days = Math.max(1, p.days)
  const hasFlight = p.items.some((i) => i.kind === 'flight')

  add('ID or driver’s license', 'documents', 'Always')
  if (p.abroad.length) add('Passport', 'documents', `Travel abroad (${p.abroad.join(', ')}) — check it’s valid for 6 months after you return`)
  if (hasFlight) add('Boarding passes (in the airline app)', 'documents', 'You have flights')
  add('The card you booked with', 'documents', 'Its trip delay and baggage protections usually need it')
  if (p.currency) add(`Some ${p.currency} cash`, 'documents', 'For small shops, taxis and tips')

  const n = Math.min(days, 7)
  const laundry = days > 7 ? ' (plan one laundry stop)' : ''
  add(`Tops × ${n}`, 'clothes', `${days} day${days === 1 ? '' : 's'}${laundry}`)
  add(`Underwear × ${n + 1}`, 'clothes', `${days} days, plus a spare${laundry}`)
  add(`Socks × ${n}`, 'clothes', `${days} day${days === 1 ? '' : 's'}`)
  add(`Pants, shorts or skirts × ${Math.max(1, Math.ceil(n / 2))}`, 'clothes', `${days} day${days === 1 ? '' : 's'}`)
  add('Sleepwear', 'clothes', 'Always')
  add('Comfortable walking shoes', 'clothes', 'Always')

  // Weather: the hottest high, the coldest low and the rainiest day anywhere on the trip, naming the city.
  const typical = (w: { kind: string }) => (w.kind === 'typical' ? ' (typical for these dates)' : '')
  const hot = p.weather.filter((w) => w.hi != null).sort((a, b) => b.hi! - a.hi!)[0]
  const cold = p.weather.filter((w) => w.lo != null).sort((a, b) => a.lo! - b.lo!)[0]
  const wet = p.weather.filter((w) => (w.rainChance ?? 0) >= 40).sort((a, b) => b.rainChance! - a.rainChance! || a.day - b.day)[0]
  if (hot && hot.hi! >= 80) {
    const why = `Highs up to ${round(hot.hi!)}°F in ${hot.city}${typical(hot)}`
    add('Light, breathable clothes', 'weather', why)
    add('Sunscreen', 'weather', why)
    add('Sunglasses', 'weather', why)
    add('Hat or cap', 'weather', why)
  }
  if (cold && cold.lo! <= 55) add('Light jacket or sweater', 'weather', `Lows around ${round(cold.lo!)}°F in ${cold.city}${typical(cold)}`)
  if (cold && cold.lo! <= 40) {
    add('Warm coat', 'weather', `Lows near ${round(cold.lo!)}°F in ${cold.city}${typical(cold)}`)
    add('Gloves and a warm hat', 'weather', `Lows near ${round(cold.lo!)}°F in ${cold.city}${typical(cold)}`)
  }
  if (wet) {
    const why = wet.kind === 'forecast' ? `${wet.rainChance}% chance of rain in ${wet.city} on Day ${wet.day}` : `It rained on Day ${wet.day}’s date in ${wet.city} in ${wet.rainChance}% of recent years`
    add('Compact umbrella or rain jacket', 'weather', why)
  }

  for (const i of p.items) {
    const text = [i.title, i.notes, i.place].filter(Boolean).join(' ')
    for (const a of ACTIVITIES) {
      if (!a.match.test(text)) continue
      for (const [label, only] of a.items) if (!only || new RegExp(`\\b(${only})`, 'i').test(text)) add(label, 'activities', `For “${i.title}”`)
    }
  }

  add('Toothbrush and toothpaste', 'toiletries', 'Always')
  add('Medications you take', 'toiletries', 'Always — keep them in your carry-on')
  if (hasFlight) add('Liquids in 3.4 oz / 100 ml bottles', 'toiletries', 'Carry-on security rule')

  add('Phone charger', 'tech', 'Always')
  add('Power bank', 'tech', hasFlight ? 'Long travel days (carry it on; it can’t go in checked bags)' : 'Long days out')
  if (hasFlight) add('Headphones', 'tech', 'For the flights')
  if (p.abroad.length) {
    add('Power adapter (check the plug type)', 'tech', `Travel abroad (${p.abroad.join(', ')})`)
    add('Phone plan or eSIM for abroad', 'tech', `Travel abroad (${p.abroad.join(', ')})`)
  }
  return [...out.values()]
}
