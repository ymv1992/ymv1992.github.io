import { randomBytes } from 'node:crypto'
import { and, asc, desc, eq, gt, gte, inArray, isNull, lte, max, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { AppDb } from '../db/client'
import { deals, trips, tripItems, type TripBooking, type TripItemKind } from '../db/schema'
import { CABINS, type Cabin } from '../domain/constants'
import type { Deal } from '../domain/types'
import { CURRENCY_CODES, toUsd, type TripRate } from '../trips/money'
import { TRIP_ITEM_KINDS } from '../trips/shared'
import { createWatch, deleteWatch } from './watchlists'

export { TRIP_ITEM_KINDS, TRIP_KIND_LABEL } from '../trips/shared'

export const MAX_TRIP_DAYS = 30
const MAX_ITEMS_PER_TRIP = 300
/** Days either side of the start date that a trip's deal watch covers. */
const WATCH_WINDOW_DAYS = 3

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date')
const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v)
const optText = (maxLen: number) => z.preprocess(blankToNull, z.string().trim().max(maxLen).nullable().default(null))

export function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000)
}

export function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
}

export const tripInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Give the trip a name').max(80),
    destination: z.preprocess((v) => v ?? '', z.string().trim().max(80)),
    destAirport: z.preprocess(
      (v) => (typeof v === 'string' ? v.trim().toUpperCase() || null : null),
      z.string().regex(/^[A-Z]{3}$/, 'Use a 3-letter airport code, like OGG').nullable(),
    ),
    startDate: z.preprocess(blankToNull, isoDate.nullable().default(null)),
    endDate: z.preprocess(blankToNull, isoDate.nullable().default(null)),
    dayCount: z.preprocess(blankToNull, z.coerce.number().int().min(1).max(MAX_TRIP_DAYS).default(3)),
    /** The destination's currency; dollars (or blank) means costs are in dollars only. */
    currency: z.preprocess((v) => (v === '' || v === 'USD' || v == null ? null : v), z.enum(CURRENCY_CODES).nullable()),
    notes: optText(1000),
  })
  .refine((v) => (v.startDate == null) === (v.endDate == null), { path: ['endDate'], message: 'Enter both dates, or neither' })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, { path: ['endDate'], message: 'The last day is before the first' })
  .refine((v) => !v.startDate || !v.endDate || daysBetween(v.startDate, v.endDate) < MAX_TRIP_DAYS, { path: ['endDate'], message: `Trips can be up to ${MAX_TRIP_DAYS} days` })

export type TripInput = z.infer<typeof tripInputSchema>

export const tripItemInputSchema = z.object({
  kind: z.enum(TRIP_ITEM_KINDS.map((k) => k.id) as [TripItemKind, ...TripItemKind[]]),
  title: z.string().trim().min(1, 'Say what it is').max(120),
  day: z.preprocess((v) => (v === '' || v === 'ideas' || v == null ? null : v), z.coerce.number().int().min(1).max(MAX_TRIP_DAYS).nullable()),
  time: z.preprocess(blankToNull, z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 09:30').nullable().default(null)),
  place: optText(200),
  url: z.preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .max(500)
      .url('Use a full link starting with https://')
      .refine((u) => /^https?:\/\//i.test(u), 'Use a link starting with https://')
      .nullable()
      .default(null),
  ),
  costAmount: z.preprocess(blankToNull, z.coerce.number().min(0).max(1_000_000_000).nullable().default(null)),
  costCurrency: z.preprocess((v) => (v === '' || v == null ? 'USD' : v), z.enum(CURRENCY_CODES)),
  points: z.preprocess(blankToNull, z.coerce.number().int().min(0).max(10_000_000).nullable().default(null)),
  notes: optText(1000),
})

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 09:30')
const iataCode = z.preprocess((v) => (typeof v === 'string' ? v.trim().toUpperCase() : v), z.string().regex(/^[A-Z]{3}$/, 'Use 3-letter airport codes, like LAX'))
const opt = <T extends z.ZodTypeAny>(t: T) => z.preprocess(blankToNull, t.nullable().default(null))

/** "ua1234", "UA 0123" or "UA-123" → "UA 1234" / "UA 123". */
export function normalizeFlightNumber(v: string): string | null {
  const m = v
    .trim()
    .toUpperCase()
    .match(/^([A-Z0-9]{2})\s*-?\s*0*(\d{1,4})([A-Z]?)$/)
  if (!m || !/[A-Z]/.test(m[1]!)) return null
  return `${m[1]} ${m[2]}${m[3]}`
}

/** Booking details as typed in the form (fields named b_…). Empty fields are left out. */
export const tripBookingInputSchema = z
  .object({
    confirmation: opt(
      z
        .string()
        .trim()
        .max(40)
        .transform((v) => v.toUpperCase()),
    ),
    flightNumber: opt(z.string().transform((v, ctx) => normalizeFlightNumber(v) ?? (ctx.addIssue({ code: 'custom', message: 'Use a flight number like UA 1234' }), z.NEVER))),
    from: opt(iataCode),
    to: opt(iataCode),
    arriveTime: opt(hhmm),
    arriveDayOffset: z.preprocess(blankToNull, z.coerce.number().int().min(0).max(2).nullable().default(null)),
    seat: opt(z.string().trim().max(10)),
    aircraft: opt(z.string().trim().max(80)),
    nights: z.preprocess(blankToNull, z.coerce.number().int().min(1).max(60).nullable().default(null)),
    checkOutTime: opt(hhmm),
    phone: opt(z.string().trim().max(40)),
  })
  .partial()

export type TripBookingInput = z.infer<typeof tripBookingInputSchema>

const FLIGHT_FIELDS = ['flightNumber', 'from', 'to', 'arriveTime', 'arriveDayOffset', 'seat', 'aircraft'] as const
const STAY_FIELDS = ['nights', 'checkOutTime', 'phone'] as const

/** Keeps the fields that fit the kind of item, and drops empty ones; null when nothing is left. */
export function cleanBooking(kind: TripItemKind, b: TripBookingInput | null | undefined): TripBooking | null {
  if (!b || kind === 'note') return null
  const keep: readonly string[] = ['confirmation', ...(kind === 'flight' ? FLIGHT_FIELDS : []), ...(kind === 'hotel' ? STAY_FIELDS : [])]
  const out: Record<string, unknown> = {}
  for (const k of keep) {
    const v = (b as Record<string, unknown>)[k]
    if (v != null && v !== '' && !(k === 'arriveDayOffset' && v === 0)) out[k] = v
  }
  return Object.keys(out).length ? (out as TripBooking) : null
}

/**
 * Carries a flight's Google Flights schedule over an edit, unless the flight
 * itself (number, airports or day) changed; then it, and an aircraft copied
 * from it, no longer apply.
 */
export function mergeBooking(prev: TripBooking | null, next: TripBooking | null, sameDay: boolean): TripBooking | null {
  const schedule = prev?.schedule
  if (!schedule) return next
  const sameFlight = sameDay && next?.flightNumber === prev?.flightNumber && next?.from === prev?.from && next?.to === prev?.to
  if (sameFlight) return { ...(next ?? {}), schedule }
  if (!next) return null
  const { aircraft, ...rest } = next
  const out = aircraft && aircraft === schedule.aircraft ? rest : next
  return Object.keys(out).length ? out : null
}

export type TripItemInput = z.infer<typeof tripItemInputSchema> & { booking?: TripBooking | null }
export type TripRow = typeof trips.$inferSelect
export type TripItemRow = typeof tripItems.$inferSelect

/** How many day columns a trip has: from its dates, or the chosen count when it has none. */
export function tripDayCount(trip: Pick<TripRow, 'startDate' | 'endDate' | 'dayCount'>): number {
  if (trip.startDate && trip.endDate) return Math.min(MAX_TRIP_DAYS, daysBetween(trip.startDate, trip.endDate) + 1)
  return trip.dayCount
}

/** The calendar date of a trip day, when the trip has dates. */
export function tripDayDate(trip: Pick<TripRow, 'startDate'>, day: number): string | null {
  return trip.startDate ? addDays(trip.startDate, day - 1) : null
}

export interface TripTotals {
  items: number
  done: number
  points: number
  /** Every cost in dollars, at the trip's locked rates. */
  cashUsd: number
  /** Costs that can't be counted in dollars yet (no rate for their currency), by currency. */
  unconverted: Record<string, number>
}

export function tripTotals(items: readonly Pick<TripItemRow, 'done' | 'points' | 'costAmount' | 'costCurrency'>[], rates: Record<string, TripRate>): TripTotals {
  let cashUsd = 0
  const unconverted: Record<string, number> = {}
  for (const i of items) {
    if (!i.costAmount) continue
    const usd = toUsd(i.costAmount, i.costCurrency, rates)
    if (usd == null) unconverted[i.costCurrency] = (unconverted[i.costCurrency] ?? 0) + i.costAmount
    else cashUsd += usd
  }
  return { items: items.length, done: items.filter((i) => i.done).length, points: items.reduce((s, i) => s + (i.points ?? 0), 0), cashUsd, unconverted }
}

export interface TripWithItems {
  trip: TripRow
  items: TripItemRow[]
}

function sortItems(items: TripItemRow[]): TripItemRow[] {
  return [...items].sort((a, b) => (a.day ?? 0) - (b.day ?? 0) || a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime())
}

export async function listTrips(db: AppDb, userId: string): Promise<(TripRow & { totals: TripTotals })[]> {
  const rows = await db.select().from(trips).where(eq(trips.userId, userId)).orderBy(sql`${trips.startDate} asc nulls last`, desc(trips.createdAt))
  if (rows.length === 0) return []
  const items = await db
    .select({ tripId: tripItems.tripId, done: tripItems.done, points: tripItems.points, costAmount: tripItems.costAmount, costCurrency: tripItems.costCurrency })
    .from(tripItems)
    .where(inArray(tripItems.tripId, rows.map((r) => r.id)))
  return rows.map((r) => ({ ...r, totals: tripTotals(items.filter((i) => i.tripId === r.id), r.rates) }))
}

export async function getTrip(db: AppDb, userId: string, tripId: string): Promise<TripWithItems | null> {
  const [trip] = await db.select().from(trips).where(and(eq(trips.id, tripId), eq(trips.userId, userId)))
  if (!trip) return null
  return { trip, items: sortItems(await db.select().from(tripItems).where(eq(tripItems.tripId, trip.id))) }
}

/** The trip behind a share link. Tokens are random, so a lookup by token alone is the access check. */
export async function getSharedTrip(db: AppDb, token: string): Promise<TripWithItems | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null
  const [trip] = await db.select().from(trips).where(eq(trips.shareToken, token))
  if (!trip) return null
  return { trip, items: sortItems(await db.select().from(tripItems).where(eq(tripItems.tripId, trip.id))) }
}

export async function createTrip(db: AppDb, userId: string, input: TripInput): Promise<string> {
  const [row] = await db
    .insert(trips)
    .values({ userId, ...input, dayCount: input.startDate && input.endDate ? daysBetween(input.startDate, input.endDate) + 1 : input.dayCount })
    .returning({ id: trips.id })
  return row!.id
}

/** Saves trip details. Items on days that no longer exist move to the ideas list rather than being lost. */
export async function updateTrip(db: AppDb, userId: string, tripId: string, input: TripInput, now = new Date()): Promise<boolean> {
  const dayCount = input.startDate && input.endDate ? daysBetween(input.startDate, input.endDate) + 1 : input.dayCount
  const updated = await db
    .update(trips)
    .set({ ...input, dayCount, updatedAt: now })
    .where(and(eq(trips.id, tripId), eq(trips.userId, userId)))
    .returning({ id: trips.id })
  if (!updated.length) return false
  const overflow = await db
    .select({ id: tripItems.id })
    .from(tripItems)
    .where(and(eq(tripItems.tripId, tripId), gt(tripItems.day, dayCount)))
    .orderBy(asc(tripItems.day), asc(tripItems.position))
  if (overflow.length) {
    const start = await nextPosition(db, tripId, null)
    for (const [i, row] of overflow.entries()) await db.update(tripItems).set({ day: null, position: start + i, updatedAt: now }).where(eq(tripItems.id, row.id))
  }
  return true
}

export async function deleteTrip(db: AppDb, userId: string, tripId: string): Promise<void> {
  const [trip] = await db.select({ watchId: trips.watchId }).from(trips).where(and(eq(trips.id, tripId), eq(trips.userId, userId)))
  if (!trip) return
  if (trip.watchId) await deleteWatch(db, userId, trip.watchId)
  await db.delete(trips).where(and(eq(trips.id, tripId), eq(trips.userId, userId)))
}

async function ownedTrip(db: AppDb, userId: string, tripId: string): Promise<TripRow | null> {
  const [trip] = await db.select().from(trips).where(and(eq(trips.id, tripId), eq(trips.userId, userId)))
  return trip ?? null
}

async function nextPosition(db: AppDb, tripId: string, day: number | null): Promise<number> {
  const [row] = await db
    .select({ p: max(tripItems.position) })
    .from(tripItems)
    .where(and(eq(tripItems.tripId, tripId), day == null ? isNull(tripItems.day) : eq(tripItems.day, day)))
  return (row?.p ?? -1) + 1
}

async function touch(db: AppDb, tripId: string, now: Date) {
  await db.update(trips).set({ updatedAt: now }).where(eq(trips.id, tripId))
}

export type ItemResult = { ok: true; id: string } | { ok: false; error: string }

export async function addTripItem(db: AppDb, userId: string, tripId: string, input: TripItemInput & { dealId?: string | null }, now = new Date()): Promise<ItemResult> {
  const trip = await ownedTrip(db, userId, tripId)
  if (!trip) return { ok: false, error: 'Trip not found' }
  if (input.day != null && input.day > tripDayCount(trip)) return { ok: false, error: `This trip has ${tripDayCount(trip)} days` }
  const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(tripItems).where(eq(tripItems.tripId, tripId))
  if ((count?.n ?? 0) >= MAX_ITEMS_PER_TRIP) return { ok: false, error: `A trip can hold up to ${MAX_ITEMS_PER_TRIP} things` }
  const [row] = await db
    .insert(tripItems)
    .values({ tripId, ...input, dealId: input.dealId ?? null, position: await nextPosition(db, tripId, input.day) })
    .returning({ id: tripItems.id })
  await touch(db, tripId, now)
  return { ok: true, id: row!.id }
}

async function ownedItem(db: AppDb, userId: string, itemId: string): Promise<{ item: TripItemRow; trip: TripRow } | null> {
  const [row] = await db
    .select({ item: tripItems, trip: trips })
    .from(tripItems)
    .innerJoin(trips, eq(trips.id, tripItems.tripId))
    .where(and(eq(tripItems.id, itemId), eq(trips.userId, userId)))
  return row ?? null
}

/** Saves an item. `placeChanged` tells the caller to look up the map and photo again. */
export async function updateTripItem(db: AppDb, userId: string, itemId: string, input: TripItemInput, now = new Date()): Promise<ItemResult & { placeChanged?: boolean }> {
  const found = await ownedItem(db, userId, itemId)
  if (!found) return { ok: false, error: 'Not found' }
  if (input.day != null && input.day > tripDayCount(found.trip)) return { ok: false, error: `This trip has ${tripDayCount(found.trip)} days` }
  const moved = input.day !== found.item.day
  // With no place or link, the title is what gets searched, so a new title counts as a new place.
  const placeChanged =
    input.place !== found.item.place || input.url !== found.item.url || (!input.place && !input.url && (input.title !== found.item.title || input.kind !== found.item.kind))
  const booking = input.booking === undefined ? undefined : mergeBooking(found.item.booking, input.booking, !moved)
  await db
    .update(tripItems)
    .set({
      ...input,
      booking,
      ...(moved ? { position: await nextPosition(db, found.trip.id, input.day) } : {}),
      ...(placeChanged ? { lat: null, lng: null, mapSpan: null, photo: null, mediaCheckedAt: null, city: null, countryCode: null, cityCheckedAt: null } : {}),
      updatedAt: now,
    })
    .where(eq(tripItems.id, itemId))
  await touch(db, found.trip.id, now)
  return { ok: true, id: itemId, placeChanged }
}

export async function deleteTripItem(db: AppDb, userId: string, itemId: string, now = new Date()): Promise<void> {
  const found = await ownedItem(db, userId, itemId)
  if (!found) return
  await db.delete(tripItems).where(eq(tripItems.id, itemId))
  await touch(db, found.trip.id, now)
}

export async function setTripItemDone(db: AppDb, userId: string, itemId: string, done: boolean, now = new Date()): Promise<void> {
  const found = await ownedItem(db, userId, itemId)
  if (!found) return
  await db.update(tripItems).set({ done, updatedAt: now }).where(eq(tripItems.id, itemId))
}

/** A trip's arrangement after a drag: every item exactly once, listed per day (null = ideas) in order. */
export const tripLayoutSchema = z
  .array(z.object({ day: z.number().int().min(1).max(MAX_TRIP_DAYS).nullable(), ids: z.array(z.string().uuid()).max(MAX_ITEMS_PER_TRIP) }))
  .max(MAX_TRIP_DAYS + 1)

export type TripLayout = z.infer<typeof tripLayoutSchema>

export async function arrangeTrip(db: AppDb, userId: string, tripId: string, layout: TripLayout, now = new Date()): Promise<{ ok: boolean; error?: string }> {
  const trip = await ownedTrip(db, userId, tripId)
  if (!trip) return { ok: false, error: 'Trip not found' }
  const days = tripDayCount(trip)
  const existing = await db.select({ id: tripItems.id, day: tripItems.day, position: tripItems.position }).from(tripItems).where(eq(tripItems.tripId, tripId))
  const listed = layout.flatMap((c) => c.ids)
  // The layout must be exactly this trip's items, so a stale or tampered request changes nothing.
  if (listed.length !== existing.length || new Set(listed).size !== listed.length || !existing.every((e) => listed.includes(e.id))) {
    return { ok: false, error: 'The trip changed in another tab. Reload and try again.' }
  }
  if (layout.some((c) => c.day != null && c.day > days)) return { ok: false, error: `This trip has ${days} days` }
  const current = new Map(existing.map((e) => [e.id, e]))
  for (const c of layout) {
    for (const [position, id] of c.ids.entries()) {
      const before = current.get(id)!
      if (before.day === c.day && before.position === position) continue
      await db.update(tripItems).set({ day: c.day, position, updatedAt: now }).where(eq(tripItems.id, id))
    }
  }
  await touch(db, tripId, now)
  return { ok: true }
}

/** Turns on the read-only share link (keeping an existing one), or turns it off. */
export async function setTripSharing(db: AppDb, userId: string, tripId: string, on: boolean, now = new Date()): Promise<string | null> {
  const trip = await ownedTrip(db, userId, tripId)
  if (!trip) return null
  const token = on ? (trip.shareToken ?? randomBytes(24).toString('base64url')) : null
  await db.update(trips).set({ shareToken: token, updatedAt: now }).where(eq(trips.id, tripId))
  return token
}

/** Adds a deal (usually a saved one) as a flight or stay, on its travel day when that falls inside the trip. */
export async function addDealToTrip(db: AppDb, userId: string, tripId: string, deal: Deal, chasePoints: number | null, now = new Date()): Promise<ItemResult> {
  const trip = await ownedTrip(db, userId, tripId)
  if (!trip) return { ok: false, error: 'Trip not found' }
  let day: number | null = null
  if (trip.startDate && deal.travelStart) {
    const d = daysBetween(trip.startDate, deal.travelStart) + 1
    if (d >= 1 && d <= tripDayCount(trip)) day = d
  }
  const isHotel = deal.kind === 'hotel'
  return addTripItem(
    db,
    userId,
    tripId,
    {
      kind: isHotel ? 'hotel' : deal.kind === 'flight' ? 'flight' : 'activity',
      title: deal.title.slice(0, 120),
      day,
      time: null,
      place: (isHotel ? deal.hotel?.property : [deal.destination.city, deal.destination.country].filter(Boolean).join(', '))?.slice(0, 200) || null,
      url: deal.bookingUrl && /^https?:\/\//i.test(deal.bookingUrl) ? deal.bookingUrl.slice(0, 500) : null,
      costAmount: deal.mandatoryCashUsd,
      costCurrency: 'USD',
      points: chasePoints,
      notes: deal.travelStart && day == null ? `Travel date ${deal.travelStart} is outside this trip's days.` : null,
      dealId: deal.id,
      // An award flight already knows its airports (and sometimes its flight number).
      booking:
        deal.kind === 'flight' && deal.originAirport && deal.destination.airport
          ? cleanBooking('flight', {
              from: deal.originAirport,
              to: deal.destination.airport,
              flightNumber: deal.flight?.flightNumbers.length === 1 ? normalizeFlightNumber(deal.flight.flightNumbers[0]!) : null,
            })
          : null,
    },
    now,
  )
}

export interface TripWatchWindow {
  dateFrom: string
  dateTo: string
}

/** Dates a trip's deal watch covers: around the start date, or the coming year for a trip without dates. */
export function tripWatchWindow(trip: Pick<TripRow, 'startDate'>, today: string): TripWatchWindow {
  if (trip.startDate) {
    const from = addDays(trip.startDate, -WATCH_WINDOW_DAYS)
    return { dateFrom: from < today ? today : from, dateTo: addDays(trip.startDate, WATCH_WINDOW_DAYS) }
  }
  return { dateFrom: today, dateTo: addDays(today, 330) }
}

export async function watchTrip(
  db: AppDb,
  userId: string,
  tripId: string,
  opts: { origins: string[]; cabin: Cabin; seatsAeroConfigured: boolean; now?: Date },
): Promise<{ ok: true; watchId: string } | { ok: false; error: string }> {
  const trip = await ownedTrip(db, userId, tripId)
  if (!trip) return { ok: false, error: 'Trip not found' }
  if (!trip.destAirport) return { ok: false, error: 'Add the airport you would fly into (for example OGG) in the trip details first.' }
  if (!opts.origins.length) return { ok: false, error: 'Add your home airports in Settings first.' }
  if (!CABINS.includes(opts.cabin)) return { ok: false, error: 'Choose a cabin' }
  const today = (opts.now ?? new Date()).toISOString().slice(0, 10)
  const window = tripWatchWindow(trip, today)
  if (window.dateTo < today) return { ok: false, error: 'This trip has already started.' }
  if (trip.watchId) await deleteWatch(db, userId, trip.watchId)
  const watchId = await createWatch(
    db,
    userId,
    {
      kind: 'route',
      label: `Trip: ${trip.name}`.slice(0, 120),
      origins: opts.origins.slice(0, 10),
      destinations: [trip.destAirport],
      property: null,
      programId: null,
      cabin: opts.cabin,
      dateFrom: window.dateFrom,
      dateTo: window.dateTo,
      maxProgramPoints: null,
      minCpp: null,
      refreshHours: 24,
      notes: `Created from the trip "${trip.name}".`,
    },
    opts.seatsAeroConfigured,
  )
  await db.update(trips).set({ watchId }).where(eq(trips.id, tripId))
  return { ok: true, watchId }
}

export async function unwatchTrip(db: AppDb, userId: string, tripId: string): Promise<void> {
  const trip = await ownedTrip(db, userId, tripId)
  if (!trip?.watchId) return
  await deleteWatch(db, userId, trip.watchId)
  await db.update(trips).set({ watchId: null }).where(eq(trips.id, tripId))
}

/** Award flights already in the app that fit the trip: into its airport, around its dates, still showing as available. */
export async function dealsForTrip(db: AppDb, trip: Pick<TripRow, 'destAirport' | 'startDate'>, today: string, limit = 5) {
  if (!trip.destAirport) return []
  const window = tripWatchWindow(trip, today)
  return db
    .select({ id: deals.id })
    .from(deals)
    .where(
      and(
        eq(deals.kind, 'flight'),
        eq(deals.destAirport, trip.destAirport),
        gte(deals.travelStart, window.dateFrom),
        lte(deals.travelStart, window.dateTo),
        isNull(deals.archivedAt),
        ne(deals.availability, 'unavailable'),
        ne(deals.sourceKind, 'demo'),
      ),
    )
    .orderBy(asc(deals.programPoints))
    .limit(limit)
}
