'use server'

import { revalidatePath } from 'next/cache'
import { requireUserId } from '@/lib/server/session'
import { runScheduled } from '@/lib/server/jobs'

export interface RunState {
  error: string | null
  ok?: string
}

/** Runs the same checks as the scheduler, for the signed-in owner only. */
export async function runChecksNowAction(_prev: RunState): Promise<RunState> {
  const userId = await requireUserId()
  try {
    const s = await runScheduled('manual', userId)
    revalidatePath('/', 'layout')
    const parts = [
      `${s.notifications} new alert${s.notifications === 1 ? '' : 's'}`,
      `${s.watchChecks} watch check${s.watchChecks === 1 ? '' : 's'}`,
      s.discovered ? `${s.discovered} new award${s.discovered === 1 ? '' : 's'} discovered` : null,
      s.hotels ? `${s.hotels} new hotel award${s.hotels === 1 ? '' : 's'}` : null,
      `${s.archived} archived`,
      s.enriched ? `${s.enriched} cash prices added` : null,
      s.announcements ? `${s.announcements} new announcements` : null,
    ].filter(Boolean)
    const notes = [...s.skipped, ...s.errors.map((e) => `Error: ${e}`)]
    return { error: null, ok: `${parts.join(' · ')}${notes.length ? ` — ${notes.join('; ')}` : ''}` }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Checks failed' }
  }
}
