import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { TRIP_KIND_LABEL, tripDayCount, tripDayDate, tripTotals, type TripItemRow, type TripRow } from '../data/trips'

const PAGE = { width: 612, height: 792 } // US Letter, points
const MARGIN = 54
const CONTENT_WIDTH = PAGE.width - MARGIN * 2
const INK = rgb(0.11, 0.13, 0.17)
const MUTED = rgb(0.42, 0.45, 0.5)
const ACCENT = rgb(0.18, 0.43, 0.42)
const RULE = rgb(0.85, 0.85, 0.82)

/** Characters the built-in PDF fonts lack, swapped for close equivalents. */
const FALLBACKS: Record<string, string> = { '→': '->', '←': '<-', '✓': 'v', '✔': 'v', '★': '*', '☆': '*', '≈': '~', '\t': ' ' }

function dayLabel(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function money(n: number): string {
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: n < 100 ? 2 : 0 })}`
}

function fileSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'trip'
  )
}

export function tripPdfFilename(trip: Pick<TripRow, 'name'>): string {
  return `${fileSlug(trip.name)}-itinerary.pdf`
}

class Writer {
  private pages: PDFPage[] = []
  private page!: PDFPage
  private y = 0
  private encodable = new Map<string, boolean>()

  constructor(
    private doc: PDFDocument,
    private regular: PDFFont,
    private bold: PDFFont,
  ) {
    this.newPage()
  }

  private newPage() {
    this.page = this.doc.addPage([PAGE.width, PAGE.height])
    this.pages.push(this.page)
    this.y = PAGE.height - MARGIN
  }

  /** Keeps text the standard fonts can draw; anything else becomes a close equivalent or "?". */
  clean(text: string): string {
    let out = ''
    for (const ch of text.normalize('NFC').replace(/\r\n?/g, '\n')) {
      if (ch === '\n') {
        out += ch
        continue
      }
      const sub = FALLBACKS[ch]
      if (sub) {
        out += sub
        continue
      }
      let ok = this.encodable.get(ch)
      if (ok === undefined) {
        try {
          this.regular.widthOfTextAtSize(ch, 10)
          ok = true
        } catch {
          ok = false
        }
        this.encodable.set(ch, ok)
      }
      // Emoji and other symbols are dropped; letters from other scripts show as "?".
      out += ok ? ch : /\p{L}|\p{N}/u.test(ch) ? '?' : ''
    }
    return out
  }

  wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const lines: string[] = []
    for (const para of this.clean(text).split('\n')) {
      let line = ''
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word
        if (font.widthOfTextAtSize(next, size) <= width) {
          line = next
          continue
        }
        if (line) lines.push(line)
        // Break words longer than a whole line (long links, for example).
        let rest = word
        while (font.widthOfTextAtSize(rest, size) > width) {
          let cut = rest.length - 1
          while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut--
          lines.push(rest.slice(0, cut))
          rest = rest.slice(cut)
        }
        line = rest
      }
      lines.push(line)
    }
    return lines
  }

  /** Starts a new page unless `height` more points fit on this one. */
  ensure(height: number) {
    if (this.y - height < MARGIN + 20) this.newPage()
  }

  gap(h: number) {
    this.y -= h
  }

  text(text: string, opts: { size?: number; font?: 'regular' | 'bold'; color?: ReturnType<typeof rgb>; x?: number; width?: number; leading?: number } = {}) {
    const size = opts.size ?? 10
    const font = opts.font === 'bold' ? this.bold : this.regular
    const x = opts.x ?? MARGIN
    const leading = opts.leading ?? size * 1.35
    for (const line of this.wrap(text, font, size, opts.width ?? CONTENT_WIDTH - (x - MARGIN))) {
      this.ensure(leading)
      this.y -= leading
      this.page.drawText(line, { x, y: this.y + (leading - size) / 2, size, font, color: opts.color ?? INK })
    }
  }

  rule() {
    this.ensure(8)
    this.y -= 4
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: PAGE.width - MARGIN, y: this.y }, thickness: 0.6, color: RULE })
    this.y -= 4
  }

  checkbox(done: boolean, topY: number) {
    const size = 9
    const x = MARGIN
    const y = topY - size - 3
    this.page.drawRectangle({ x, y, width: size, height: size, borderColor: MUTED, borderWidth: 0.8 })
    if (done) {
      this.page.drawLine({ start: { x: x + 1.8, y: y + 4.6 }, end: { x: x + 3.8, y: y + 2.2 }, thickness: 1.2, color: ACCENT })
      this.page.drawLine({ start: { x: x + 3.8, y: y + 2.2 }, end: { x: x + 7.4, y: y + 7.4 }, thickness: 1.2, color: ACCENT })
    }
  }

  get cursor() {
    return this.y
  }

  footer(label: string) {
    const total = this.pages.length
    this.pages.forEach((p, i) => {
      const text = this.clean(`${label} · Page ${i + 1} of ${total}`)
      p.drawText(text, { x: MARGIN, y: MARGIN - 24, size: 8, font: this.regular, color: MUTED })
    })
  }
}

function itemBlock(w: Writer, item: TripItemRow) {
  const meta = [
    TRIP_KIND_LABEL[item.kind],
    item.place,
    item.points ? `${item.points.toLocaleString('en-US')} Chase pts` : null,
    item.costUsd ? money(item.costUsd) : null,
  ]
    .filter(Boolean)
    .join(' · ')
  // Keep the title and its first details together on one page.
  w.ensure(32)
  const top = w.cursor
  w.checkbox(item.done, top)
  const x = MARGIN + 18
  w.text(item.time ? `${item.time}   ${item.title}` : item.title, { font: 'bold', size: 11, x })
  if (meta) w.text(meta, { size: 9.5, color: MUTED, x })
  if (item.url) w.text(item.url, { size: 8.5, color: ACCENT, x })
  if (item.notes) w.text(item.notes, { size: 9.5, x })
  w.gap(6)
}

/** A printable itinerary: trip details, each day with its plans (and tick boxes), then unscheduled ideas. */
export async function buildTripPdf(trip: TripRow, items: TripItemRow[], now = new Date()): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(`${trip.name} itinerary`)
  doc.setCreator('Points & Paradise')
  doc.setProducer('Points & Paradise')
  doc.setCreationDate(now)
  const w = new Writer(doc, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold))
  const days = tripDayCount(trip)
  const totals = tripTotals(items)

  w.text(trip.name, { font: 'bold', size: 20, leading: 26 })
  const when = trip.startDate && trip.endDate ? `${dayLabel(trip.startDate)} to ${dayLabel(trip.endDate)}` : `${days} day${days === 1 ? '' : 's'}, dates not set`
  w.text([trip.destination, when].filter(Boolean).join(' · '), { size: 11, color: MUTED })
  const sums = [
    `${totals.items} thing${totals.items === 1 ? '' : 's'} planned`,
    totals.done ? `${totals.done} done` : null,
    totals.points ? `${totals.points.toLocaleString('en-US')} Chase points` : null,
    totals.cashUsd ? `${money(totals.cashUsd)} cash` : null,
  ].filter(Boolean)
  w.text(sums.join(' · '), { size: 10, color: MUTED })
  if (trip.notes) {
    w.gap(6)
    w.text(trip.notes, { size: 10 })
  }
  w.gap(10)

  for (let day = 1; day <= days; day++) {
    const date = tripDayDate(trip, day)
    w.ensure(48)
    w.text(date ? `Day ${day} · ${dayLabel(date)}` : `Day ${day}`, { font: 'bold', size: 13, leading: 20 })
    w.rule()
    const list = items.filter((i) => i.day === day)
    if (!list.length) w.text('Nothing planned yet.', { size: 9.5, color: MUTED })
    for (const item of list) itemBlock(w, item)
    w.gap(8)
  }

  const ideas = items.filter((i) => i.day == null)
  if (ideas.length) {
    w.ensure(48)
    w.text('Ideas (not on a day yet)', { font: 'bold', size: 13, leading: 20 })
    w.rule()
    for (const item of ideas) itemBlock(w, item)
  }

  w.footer(`${trip.name} · made with Points & Paradise on ${now.toISOString().slice(0, 10)}`)
  return doc.save()
}
