/** Deterministic parsing of a plain-language trip request into planner inputs. */

const WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
}

function toNumber(raw: string, multiplier?: string): number | null {
  const word = WORDS[raw.toLowerCase()]
  const n = word ?? Number(raw.replace(/,/g, ''))
  if (!Number.isFinite(n)) return null
  return multiplier && /^(k|thousand)$/i.test(multiplier) ? n * 1000 : n
}

export interface ParsedTripRequest {
  points: number | null
  cashUsd: number | null
  months: number | null
  minNights: number | null
  maxNights: number | null
  travelers: number | null
  interpreted: string[]
}

export function parseTripRequest(text: string): ParsedTripRequest {
  const t = text.slice(0, 1000)
  const out: ParsedTripRequest = { points: null, cashUsd: null, months: null, minNights: null, maxNights: null, travelers: null, interpreted: [] }
  const pts = /(\d[\d,.]*)\s*(k|thousand)?\s*(?:chase\s+|ultimate\s+rewards\s+|ur\s+)?(?:points|pts)\b/i.exec(t)
  if (pts) {
    out.points = toNumber(pts[1]!, pts[2])
    if (out.points != null) out.interpreted.push(`${out.points.toLocaleString('en-US')} Chase points`)
  }
  const cash = /\$\s?(\d[\d,]*(?:\.\d+)?)\s*(k|thousand)?/i.exec(t)
  if (cash) {
    out.cashUsd = toNumber(cash[1]!, cash[2])
    if (out.cashUsd != null) out.interpreted.push(`$${out.cashUsd.toLocaleString('en-US')} cash`)
  }
  const months = /(?:next|within|in the next|in)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+months?/i.exec(t)
  if (months) {
    out.months = toNumber(months[1]!)
    if (out.months != null) out.interpreted.push(`within ${out.months} months`)
  } else if (/next\s+year/i.test(t)) {
    out.months = 12
    out.interpreted.push('within 12 months')
  }
  const range = /(\d+)\s*(?:-|–|to)\s*(\d+)\s*nights?/i.exec(t)
  const single = /(\d+)\s*nights?/i.exec(t)
  if (range) {
    out.minNights = Number(range[1])
    out.maxNights = Number(range[2])
  } else if (single) {
    out.minNights = Number(single[1])
    out.maxNights = Number(single[1])
  } else if (/\b(a|one)\s+week\b/i.test(t)) {
    out.minNights = 6
    out.maxNights = 8
  } else if (/\bweekend\b/i.test(t)) {
    out.minNights = 2
    out.maxNights = 3
  }
  if (out.minNights != null) out.interpreted.push(out.minNights === out.maxNights ? `${out.minNights} nights` : `${out.minNights}–${out.maxNights} nights`)
  const people = /(?:for|with)\s+(\d+|two|three|four|five|six)\s*(?:people|travelers|travellers|adults|of us)?\b/i.exec(t) ?? /(\d+)\s+(?:people|travelers|travellers|adults)/i.exec(t)
  if (people) out.travelers = toNumber(people[1]!)
  else if (/\b(couple|honeymoon|my (wife|husband|partner))\b/i.test(t)) out.travelers = 2
  else if (/\bsolo\b|\bjust me\b|\bby myself\b/i.test(t)) out.travelers = 1
  if (out.travelers != null) out.interpreted.push(`${out.travelers} traveler${out.travelers === 1 ? '' : 's'}`)
  return out
}
