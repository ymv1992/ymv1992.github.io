/** The search log records sensible durations whatever clock the caller used. */
import { beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/client'
import { searchJobs } from '@/lib/db/schema'
import { logJob } from '@/lib/data/usage'
import { createTestDb } from '../test-db'

let db: AppDb

beforeAll(async () => {
  db = await createTestDb()
}, 60_000)

describe('logJob', () => {
  it('gives a skipped job no duration, even when its start time is months old', async () => {
    const startedAt = new Date('2020-01-01T00:00:00Z')
    await logJob(db, { provider: 'seats_aero', jobType: 'job_log_test', status: 'skipped_quota', startedAt, error: 'Daily quota reached' })
    const [row] = await db.select().from(searchJobs).where(eq(searchJobs.jobType, 'job_log_test'))
    expect(row!.durationMs).toBe(0)
    expect(row!.finishedAt!.getTime()).toBe(startedAt.getTime())
  })
})
