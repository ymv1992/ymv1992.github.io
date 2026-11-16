import { normalizeSymbol } from '../domain/reference'

export interface ParsedHolding {
  symbol: string
  quantity: number
  avgCost: number | null
  name: string
  account: string
  purchaseDate: string | null
}

export interface ParseResult {
  rows: ParsedHolding[]
  errors: string[]
}

function num(raw: string | undefined): number | null {
  if (raw == null) return null
  const s = raw.replace(/[$,\s]/g, '')
  if (!s || s.includes('?')) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Splits one CSV line, honouring double quotes. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',' || ch === '\t') {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  out.push(cur.trim())
  return out
}

const HEADER_PATTERNS: [keyof ParsedHolding, RegExp][] = [
  ['symbol', /^(symbol|ticker|asset|instrument)$/i],
  ['quantity', /^(shares|quantity|qty|units|amount|total qty)$/i],
  ['avgCost', /^(avg\.? ?cost|average cost|avg\.? ?price|average price|cost ?\/ ?share|cost per share|cost basis per share|purchase price)$/i],
  ['name', /^(name|description|company|security)$/i],
  ['account', /^(account|brokerage|broker)$/i],
  ['purchaseDate', /^(purchase date|date acquired|date|open date)$/i],
]

/**
 * Reads holdings from pasted text. Accepts a CSV with a header row, or a
 * quick list such as "ABC 10 / $12.50 · XYZ 3 / $4" (one per line or
 * separated by · ; |). A "?" or blank cost is kept as unknown.
 */
export function parseHoldings(text: string): ParseResult {
  const rows: ParsedHolding[] = []
  const errors: string[] = []
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (!lines.length) return { rows, errors: ['Nothing to import.'] }

  const header = splitCsvLine(lines[0]!)
  const isCsv = header.some((h) => HEADER_PATTERNS[0]![1].test(h))
  if (isCsv) {
    const col: Partial<Record<keyof ParsedHolding, number>> = {}
    header.forEach((h, i) => {
      for (const [key, re] of HEADER_PATTERNS) if (col[key] === undefined && re.test(h)) col[key] = i
    })
    if (col.quantity === undefined) return { rows, errors: ['The file needs a "Shares" or "Quantity" column.'] }
    lines.slice(1).forEach((line, i) => {
      const c = splitCsvLine(line)
      const symbol = normalizeSymbol(c[col.symbol!] ?? '')
      const quantity = num(c[col.quantity!])
      if (!symbol || !/^[A-Z0-9.\-]{1,12}$/.test(symbol)) return void errors.push(`Row ${i + 2}: unreadable symbol "${c[col.symbol!] ?? ''}".`)
      if (quantity == null || quantity <= 0) return void errors.push(`Row ${i + 2} (${symbol}): unreadable quantity.`)
      const d = col.purchaseDate !== undefined ? c[col.purchaseDate] : undefined
      rows.push({
        symbol,
        quantity,
        avgCost: col.avgCost !== undefined ? num(c[col.avgCost]) : null,
        name: col.name !== undefined ? (c[col.name] ?? '') : '',
        account: col.account !== undefined ? (c[col.account] ?? '') : '',
        purchaseDate: d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null,
      })
    })
  } else {
    const tokens = lines.flatMap((l) => l.split(/[·;|•]/)).map((t) => t.trim()).filter(Boolean)
    for (const t of tokens) {
      const m = /^\$?([A-Za-z][A-Za-z0-9.\-]{0,11})\s*[:,]?\s+([\d.,]+)(?:\s*(?:\/|@|,|\s)\s*(\$?[\d.,?]+))?\s*$/.exec(t)
      const quantity = m ? num(m[2]) : null
      if (!m || quantity == null || quantity <= 0) {
        errors.push(`Could not read "${t.slice(0, 40)}".`)
        continue
      }
      rows.push({ symbol: normalizeSymbol(m[1]!), quantity, avgCost: num(m[3]), name: '', account: '', purchaseDate: null })
    }
  }

  // The same symbol twice in one account is merged (weighted average cost).
  const merged = new Map<string, ParsedHolding>()
  for (const r of rows) {
    const key = `${r.account}|${r.symbol}`
    const prev = merged.get(key)
    if (!prev) merged.set(key, { ...r })
    else {
      const qty = prev.quantity + r.quantity
      prev.avgCost = prev.avgCost != null && r.avgCost != null ? (prev.avgCost * prev.quantity + r.avgCost * r.quantity) / qty : null
      prev.quantity = qty
    }
  }
  return { rows: [...merged.values()], errors }
}

export type ImportChange = 'new' | 'changed' | 'same'

export interface ImportDiffRow extends ParsedHolding {
  change: ImportChange
  existing: { quantity: number; avgCost: number | null; status: string } | null
}

/** Compares an import with what is already stored, so nothing is overwritten unseen. */
export function diffImport(
  rows: ParsedHolding[],
  existing: { symbol: string; account: string; quantity: number; avgCost: number | null; status: string }[],
): ImportDiffRow[] {
  const index = new Map(existing.map((e) => [`${e.account}|${e.symbol}`, e]))
  return rows.map((r) => {
    const e = index.get(`${r.account}|${r.symbol}`) ?? null
    const same = e && Math.abs(e.quantity - r.quantity) < 1e-9 && (r.avgCost == null || (e.avgCost != null && Math.abs(e.avgCost - r.avgCost) < 1e-6))
    return { ...r, change: !e ? 'new' : same ? 'same' : 'changed', existing: e ? { quantity: e.quantity, avgCost: e.avgCost, status: e.status } : null }
  })
}
