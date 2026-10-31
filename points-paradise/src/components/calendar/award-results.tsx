import Link from 'next/link'
import type { CSSProperties } from 'react'
import type { AwardSearchResultRow, CabinCompareRow, RoundTripPick } from '@/lib/data/award-search'
import { airlineNames, programUnit } from '@/lib/domain/airlines'
import { CABIN_LABELS } from '@/lib/domain/constants'
import { bonusNotes, cabinsIn, lowestByCabin, optionCost, seatsLabel, upgradeNote } from '@/lib/search/compare'
import { PriceButton } from '../deal/price-button'

export function shortDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function monthLabel(ym: string): string {
  const d = new Date(`${ym}-15T12:00:00Z`)
  return Number.isNaN(d.getTime()) ? ym : d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

const pts = (v: number) => v.toLocaleString('en-US')

/** A small "+30%" tag on options whose program has an active Chase transfer bonus. */
function BonusTag({ row }: { row: AwardSearchResultRow }) {
  if (!row.bonus) return null
  return (
    <span className="rounded-full bg-gold-soft px-1.5 py-0.5 text-[11px] font-semibold text-gold" title={`Chase transfer bonus to ${row.bonus.partnerName}`}>
      +{row.bonus.percent}% bonus
    </span>
  )
}

/** "= 46,154 Chase pts (60,000 without the bonus)" when a bonus changes the Chase points. */
function ChaseLine({ row }: { row: AwardSearchResultRow }) {
  if (!row.bonus || row.chasePoints == null) return null
  return (
    <span className="text-xs text-muted">
      = {pts(row.chasePoints)} Chase pts{row.bonus.chasePointsWithout != null ? ` (${pts(row.bonus.chasePointsWithout)} without the bonus)` : ''}
    </span>
  )
}

export function BonusNotes({ rows }: { rows: readonly AwardSearchResultRow[] }) {
  const notes = bonusNotes(rows)
  if (!notes.length) return null
  return (
    <ul className="mt-3 space-y-1 text-xs text-muted">
      {notes.map((b) => (
        <li key={b.partnerName}>
          <span className="font-semibold text-gold">+{b.percent}% transfer bonus.</span> {b.text}
        </li>
      ))}
    </ul>
  )
}

/** Cheapest-first list for one cabin. */
export function ResultList({ rows, seats, canPrice, label }: { rows: readonly AwardSearchResultRow[]; seats: number; canPrice: boolean; label: string }) {
  return (
    <ul className="divide-y divide-line rounded-xl border border-line" aria-label={label}>
      {rows.map((r) => {
        const seatText = seatsLabel(r.seats, seats)
        return (
          <li key={r.dealId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2.5">
            <Link href={`/deals/${r.dealId}`} className="hover:underline">
              <span className="font-semibold">
                {r.city}
                {r.country ? `, ${r.country}` : ''}
              </span>{' '}
              <span className="text-muted">
                {r.origin} → {r.airport} · {shortDate(r.date)}
                {r.direct ? ' · nonstop' : ''}
              </span>
            </Link>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="tabular text-sm">
                <span className="font-semibold">
                  {pts(r.points)} {programUnit(r.programId)}
                </span>
                {r.taxesUsd != null ? ` + $${Math.round(r.taxesUsd)}` : ''} <span className="text-muted">· {airlineNames(r.airline)}</span>
              </span>
              <BonusTag row={r} />
              <ChaseLine row={r} />
              {seatText && <span className={`text-xs ${r.seats == null ? 'text-warn' : 'text-muted'}`}>{seatText}</span>}
              <PriceButton dealId={r.dealId} cpp={r.cpp} cashUsd={r.cashUsd} tried={r.cashLookupTried} canPrice={canPrice} />
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/** Every cabin side by side, one row per date (or per city and month for "Anywhere"). */
export function CompareTable({ rows, seats, anywhere, label }: { rows: readonly CabinCompareRow[]; seats: number; anywhere: boolean; label: string }) {
  const cabins = cabinsIn(rows)
  const lowest = lowestByCabin(rows)
  const cols = { gridTemplateColumns: `minmax(9rem, 1.3fr) repeat(${cabins.length}, minmax(0, 1fr))` }
  return (
    <div>
      <div role="table" aria-label={label} className="rounded-xl border border-line">
        <div role="row" className="hidden gap-3 border-b border-line px-3 py-2 text-xs font-medium text-faint sm:grid" style={cols}>
          <span role="columnheader">{anywhere ? 'Destination · month' : 'Date'}</span>
          {cabins.map((c) => (
            <span key={c} role="columnheader">
              {CABIN_LABELS[c]}
            </span>
          ))}
        </div>
        {rows.map((row) => {
          const note = upgradeNote(row.cells)
          return (
            <div key={row.key} role="row" className="border-b border-line px-3 py-2.5 last:border-b-0">
              <div className="grid grid-cols-2 gap-2 sm:gap-3 sm:[grid-template-columns:var(--cols)]" style={{ '--cols': cols.gridTemplateColumns } as CSSProperties}>
                <div role="rowheader" className="col-span-2 sm:col-span-1">
                  <span className="font-semibold">{anywhere ? `${row.city}${row.country ? `, ${row.country}` : ''}` : shortDate(row.when)}</span>
                  <span className="block text-xs text-muted">{anywhere ? monthLabel(row.when) : `${row.origin} → ${row.airport}`}</span>
                </div>
                {cabins.map((c) => {
                  const cell = row.cells[c]
                  if (!cell)
                    return (
                      <div key={c} role="cell" className="rounded-lg px-2 py-1.5 text-sm text-faint">
                        <span className="block text-[11px] sm:hidden">{CABIN_LABELS[c]}</span>
                        <span aria-label={`${CABIN_LABELS[c]}: no seats`}>—</span>
                      </div>
                    )
                  const best = optionCost(cell) === lowest[c]
                  const seatText = seatsLabel(cell.seats, seats)
                  return (
                    <div key={c} role="cell" className={`rounded-lg px-2 py-1.5 text-sm ${best ? 'bg-ok-soft ring-1 ring-ok/40' : ''}`}>
                      <span className="block text-[11px] text-faint sm:hidden">{CABIN_LABELS[c]}</span>
                      <Link href={`/deals/${cell.dealId}`} className="tabular font-semibold hover:underline">
                        {pts(cell.points)} <span className="font-normal text-muted">{programUnit(cell.programId)}</span>
                      </Link>
                      {best && <span className="sr-only"> (lowest {CABIN_LABELS[c]} price in this list)</span>}
                      <span className="block text-xs text-muted">
                        {cell.taxesUsd != null ? `+ $${Math.round(cell.taxesUsd)} · ` : ''}
                        {airlineNames(cell.airline)}
                        {cell.direct ? ' · nonstop' : ''}
                      </span>
                      {anywhere && (
                        <span className="block text-xs text-muted">
                          {shortDate(cell.date)} from {cell.origin}
                        </span>
                      )}
                      {cell.bonus && (
                        <span className="mt-0.5 flex flex-wrap items-center gap-1">
                          <BonusTag row={cell} />
                          {cell.chasePoints != null && <span className="text-xs text-muted">{pts(cell.chasePoints)} Chase pts</span>}
                        </span>
                      )}
                      {seatText && <span className={`block text-xs ${cell.seats == null ? 'text-warn' : 'text-muted'}`}>{seatText}</span>}
                    </div>
                  )
                })}
              </div>
              {note && <p className="mt-1 text-xs text-primary">{note}</p>}
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-xs text-muted">Green marks the lowest price for each cabin in this list. Tap a price for details and the cash value.</p>
    </div>
  )
}

/** The cheapest way there and back in each cabin. */
export function RoundTripSummary({ picks, seats }: { picks: readonly RoundTripPick[]; seats: number }) {
  if (!picks.length) return null
  const cost = (p: RoundTripPick) => p.chasePoints ?? p.points
  const cheapest = Math.min(...picks.map(cost))
  return (
    <section aria-label="Best round trips" className="rounded-xl border border-line p-3">
      <h3 className="text-sm font-semibold">Best round trip in each cabin</h3>
      <p className="text-xs text-muted">Booked as two one-way awards, which can use different programs. Points are per person.</p>
      <ul className="mt-2 space-y-2">
        {picks.map((p) => (
          <li key={p.cabin} className={`rounded-lg px-2.5 py-2 text-sm ${cost(p) === cheapest ? 'bg-ok-soft ring-1 ring-ok/40' : 'bg-surface-2/60'}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="font-semibold">{CABIN_LABELS[p.cabin]}</span>
              <span className="tabular">
                <span className="font-semibold">{p.chasePoints != null ? `${pts(p.chasePoints)} Chase pts` : `${pts(p.points)} points`}</span>
                {p.taxesUsd != null ? ` + $${Math.round(p.taxesUsd)}` : ''}
                {seats > 1 && <span className="text-muted"> · {pts(cost(p) * seats)} for {seats} people</span>}
              </span>
            </div>
            <div className="mt-1 grid gap-1 text-xs text-muted sm:grid-cols-2">
              {(
                [
                  ['Out', p.out],
                  ['Back', p.back],
                ] as const
              ).map(([leg, r]) => (
                <Link key={leg} href={`/deals/${r.dealId}`} className="hover:underline">
                  <span className="font-medium text-ink">{leg}:</span> {r.origin} → {r.airport} · {shortDate(r.date)} · {pts(r.points)} {programUnit(r.programId)} · {airlineNames(r.airline)}
                  {r.bonus ? ` · +${r.bonus.percent}% bonus` : ''}
                </Link>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
