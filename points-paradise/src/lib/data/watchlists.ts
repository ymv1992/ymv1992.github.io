import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { CABINS } from '../domain/constants'
import type { Deal } from '../domain/types'
import type { AppDb } from '../db/client'
import { watchlists } from '../db/schema'

/**
 * Chase partner → seats.aero "Source" identifiers. Only mappings we are
 * confident of are listed; add more after checking the seats.aero docs.
 */
export const SEATS_AERO_PROGRAMS: Record<string, string> = {
  aeroplan: 'aeroplan',
  united: 'united',
  flying_blue: 'flyingblue',
  virgin_atlantic: 'virginatlantic',
}

export function autoCheckProvider(kind: 'flight' | 'hotel' | 'package' | 'experience', programId: string | null, seatsAeroConfigured: boolean): string | null {
  if (kind === 'flight' && programId && SEATS_AERO_PROGRAMS[programId] && seatsAeroConfigured) return 'seats_aero'
  return null
}

const codes = z.preprocess(
  (v) =>
    (typeof v === 'string' ? v.split(/[,\s]+/) : Array.isArray(v) ? v : [])
      .map((s) => String(s).trim().toUpperCase())
      .filter(Boolean),
  z.array(z.string().regex(/^[A-Z]{3}$/, 'Use 3-letter airport codes')).max(10),
)

export const watchInputSchema = z
  .object({
    kind: z.enum(['route', 'property', 'similar']),
    label: z.string().trim().min(1).max(120),
    origins: codes,
    destinations: codes,
    property: z.preprocess((v) => (v === '' ? null : v), z.string().max(200).nullable().default(null)),
    programId: z.preprocess((v) => (v === '' ? null : v), z.string().max(60).nullable().default(null)),
    cabin: z.preprocess((v) => (v === '' ? null : v), z.enum(CABINS).nullable().default(null)),
    dateFrom: z.preprocess((v) => (v === '' ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null)),
    dateTo: z.preprocess((v) => (v === '' ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null)),
    maxProgramPoints: z.preprocess((v) => (v === '' || v == null ? null : v), z.coerce.number().int().min(0).nullable()),
    minCpp: z.preprocess((v) => (v === '' || v == null ? null : v), z.coerce.number().min(0).max(50).nullable()),
    refreshHours: z.coerce.number().int().min(6).max(24 * 14).default(24),
    notes: z.preprocess((v) => (v === '' ? null : v), z.string().max(500).nullable().default(null)),
  })
  .refine((v) => v.kind !== 'route' || (v.origins.length > 0 && v.destinations.length > 0), {
    path: ['destinations'],
    message: 'A route watch needs origin and destination airports',
  })
  .refine((v) => v.kind !== 'property' || !!v.property, { path: ['property'], message: 'Enter the property name' })
  .refine((v) => !v.dateFrom || !v.dateTo || v.dateTo >= v.dateFrom, { path: ['dateTo'], message: 'End date is before start date' })

export type WatchInput = z.infer<typeof watchInputSchema>

export async function createWatch(db: AppDb, userId: string, input: WatchInput, seatsAeroConfigured: boolean): Promise<string> {
  const provider = input.kind === 'route' && input.programId ? autoCheckProvider('flight', input.programId, seatsAeroConfigured) : input.kind === 'route' && seatsAeroConfigured ? 'seats_aero' : null
  const [row] = await db
    .insert(watchlists)
    .values({
      userId,
      kind: input.kind,
      label: input.label,
      origins: input.origins,
      destinations: input.destinations,
      property: input.property,
      programId: input.programId,
      cabin: input.cabin,
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      criteria: { maxProgramPoints: input.maxProgramPoints, minCpp: input.minCpp },
      refreshHours: input.refreshHours,
      provider,
      autoCheckSupported: provider != null,
      notes: input.notes,
    })
    .returning({ id: watchlists.id })
  return row!.id
}

/** "Watch this deal": schedules automatic re-checks when a permitted provider supports it. */
export async function watchDeal(db: AppDb, userId: string, deal: Deal, seatsAeroConfigured: boolean): Promise<{ id: string; autoCheck: boolean }> {
  const existing = await db
    .select({ id: watchlists.id, auto: watchlists.autoCheckSupported })
    .from(watchlists)
    .where(and(eq(watchlists.userId, userId), eq(watchlists.dealId, deal.id)))
  if (existing[0]) {
    await db.update(watchlists).set({ active: true }).where(eq(watchlists.id, existing[0].id))
    return { id: existing[0].id, autoCheck: existing[0].auto }
  }
  const provider = autoCheckProvider(deal.kind, deal.programId, seatsAeroConfigured)
  const [row] = await db
    .insert(watchlists)
    .values({
      userId,
      kind: 'deal',
      dealId: deal.id,
      label: deal.title,
      origins: deal.originAirport ? [deal.originAirport] : [],
      destinations: deal.destination.airport ? [deal.destination.airport] : [],
      property: deal.hotel?.property ?? null,
      programId: deal.programId,
      cabin: deal.flight?.cabin ?? null,
      dateFrom: deal.travelStart,
      dateTo: deal.flexibleDates ? deal.travelEnd : deal.travelStart,
      refreshHours: 24,
      provider,
      autoCheckSupported: provider != null,
    })
    .returning({ id: watchlists.id })
  return { id: row!.id, autoCheck: provider != null }
}

export async function listWatches(db: AppDb, userId: string) {
  return db.select().from(watchlists).where(eq(watchlists.userId, userId)).orderBy(desc(watchlists.createdAt))
}

export async function setWatchActive(db: AppDb, userId: string, id: string, active: boolean) {
  await db.update(watchlists).set({ active }).where(and(eq(watchlists.id, id), eq(watchlists.userId, userId)))
}

export async function deleteWatch(db: AppDb, userId: string, id: string) {
  await db.delete(watchlists).where(and(eq(watchlists.id, id), eq(watchlists.userId, userId)))
}
