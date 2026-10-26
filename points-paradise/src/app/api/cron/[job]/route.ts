import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { config } from '@/lib/server/config'
import { runScheduled } from '@/lib/server/jobs'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorized(req: NextRequest): boolean {
  const secret = config.cronSecret()
  if (!secret) return false
  const header = req.headers.get('authorization') ?? ''
  const expected = Buffer.from(`Bearer ${secret}`)
  const got = Buffer.from(header)
  return got.length === expected.length && timingSafeEqual(got, expected)
}

/**
 * Scheduled entry point. Vercel Cron sends `Authorization: Bearer $CRON_SECRET`
 * automatically; the GitHub Actions workflow sends the same header.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ job: string }> }) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { job } = await ctx.params
  if (job !== 'daily' && job !== 'frequent' && job !== 'discover') return NextResponse.json({ error: 'Unknown job' }, { status: 404 })
  try {
    const summary = await runScheduled(job)
    return NextResponse.json({ ok: true, summary })
  } catch (err) {
    console.error('cron job failed', err)
    return NextResponse.json({ ok: false, error: 'Job failed — see server logs' }, { status: 500 })
  }
}
