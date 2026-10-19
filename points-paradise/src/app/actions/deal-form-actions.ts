'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { manualDealSchema, parseCsv } from '@/lib/data/deal-input'
import { createManualDeal, updateManualDeal } from '@/lib/data/deals'
import { searchHistory } from '@/lib/db/schema'
import { isValidTimeZone, zonedWallTimeToDate } from '@/lib/time'
import { requireUserId } from '@/lib/server/session'

export interface DealFormState {
  error: string | null
  fieldErrors?: Record<string, string>
  values?: Record<string, string>
  /** Changes on every failed attempt so the form remounts with the submitted values. */
  attempt?: number
}

function formToObject(fd: FormData): Record<string, unknown> {
  const obj: Record<string, unknown> = {}
  for (const [k, v] of fd.entries()) {
    if (k.startsWith('$')) continue
    if (k === 'tags') continue
    obj[k] = typeof v === 'string' ? v : ''
  }
  obj.tags = fd.getAll('tags').map(String)
  return obj
}

/** Converts a datetime-local deadline into an instant in the stated time zone. */
function normalizeDeadline(obj: Record<string, unknown>): string | null {
  const local = String(obj.deadlineAt ?? '')
  if (!local) return null
  const tz = String(obj.deadlineTimezone || 'America/Los_Angeles')
  if (!isValidTimeZone(tz)) return `Unknown time zone "${tz}"`
  const d = zonedWallTimeToDate(local, tz)
  if (!d) return 'Invalid deadline'
  obj.deadlineAt = d.toISOString()
  obj.deadlineTimezone = tz
  return null
}

function issuesToFields(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const i of err.issues) {
    const key = String(i.path[0] ?? 'form')
    if (!out[key]) out[key] = i.message
  }
  return out
}

export async function saveDealAction(dealId: string | null, prev: DealFormState, fd: FormData): Promise<DealFormState> {
  const result = await saveDeal(dealId, fd)
  return { ...result, attempt: (prev.attempt ?? 0) + 1 }
}

async function saveDeal(dealId: string | null, fd: FormData): Promise<DealFormState> {
  const userId = await requireUserId()
  const raw = formToObject(fd)
  const values = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v ?? '')]))
  const tzErr = normalizeDeadline(raw)
  if (tzErr) return { error: tzErr, fieldErrors: { deadlineAt: tzErr }, values }
  const parsed = manualDealSchema.safeParse(raw)
  if (!parsed.success) return { error: 'Please fix the highlighted fields.', fieldErrors: issuesToFields(parsed.error), values }
  const db = await getDb()
  let target: string
  let merged = false
  try {
    if (dealId) {
      if (!z.string().uuid().safeParse(dealId).success) return { error: 'Invalid deal', values }
      await updateManualDeal(db, dealId, parsed.data)
      target = dealId
    } else {
      const res = await createManualDeal(db, userId, parsed.data)
      target = res.id
      merged = !res.isNew
      await db.insert(searchHistory).values({ userId, context: 'manual_deal', query: { destination: parsed.data.destCity, kind: parsed.data.kind } })
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not save the deal', values }
  }
  revalidatePath('/', 'layout')
  redirect(`/deals/${target}${merged ? '?merged=1' : ''}`)
}

export interface ImportState {
  error: string | null
  created?: number
  merged?: number
  failures?: { row: number; message: string }[]
}

export async function importDealsAction(_prev: ImportState, fd: FormData): Promise<ImportState> {
  const userId = await requireUserId()
  const text = String(fd.get('payload') ?? '').trim()
  if (!text) return { error: 'Paste JSON or CSV, or choose a file.' }
  if (text.length > 2_000_000) return { error: 'File is too large (2 MB max).' }
  let rows: Record<string, unknown>[]
  try {
    rows = text.startsWith('[') || text.startsWith('{') ? [JSON.parse(text)].flat() : parseCsv(text)
  } catch {
    return { error: 'Could not parse the input as JSON or CSV.' }
  }
  if (rows.length === 0) return { error: 'No rows found.' }
  if (rows.length > 500) return { error: 'Import at most 500 rows at a time.' }
  const db = await getDb()
  let created = 0
  let merged = 0
  const failures: { row: number; message: string }[] = []
  for (const [i, row] of rows.entries()) {
    if (typeof row !== 'object' || row == null) {
      failures.push({ row: i + 1, message: 'Not an object' })
      continue
    }
    const obj = { ...row } as Record<string, unknown>
    if (typeof obj.deadlineAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(obj.deadlineAt)) {
      const e = normalizeDeadline(obj)
      if (e) {
        failures.push({ row: i + 1, message: e })
        continue
      }
    }
    const parsed = manualDealSchema.safeParse(obj)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      failures.push({ row: i + 1, message: issue ? `${issue.path.join('.')}: ${issue.message}` : 'Invalid row' })
      continue
    }
    try {
      const res = await createManualDeal(db, userId, parsed.data)
      if (res.isNew) created++
      else merged++
    } catch (err) {
      failures.push({ row: i + 1, message: err instanceof Error ? err.message : 'Could not save' })
    }
  }
  revalidatePath('/', 'layout')
  return { error: null, created, merged, failures: failures.slice(0, 50) }
}
