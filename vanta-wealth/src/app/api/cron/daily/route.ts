import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { getDb } from '@/lib/db/client'
import { users } from '@/lib/db/schema'
import { listHoldings, loadOverview, recordSnapshot, refreshNews, refreshQuotes } from '@/lib/data/store'
import { config } from '@/lib/server/config'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorized(req: NextRequest): boolean {
  const secret = config.cronSecret()
  if (!secret) return false
  const expected = Buffer.from(`Bearer ${secret}`)
  const got = Buffer.from(req.headers.get('authorization') ?? '')
  return got.length === expected.length && timingSafeEqual(got, expected)
}

/** Daily job: refresh prices and news, then record the day's portfolio value. */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const db = await getDb()
    const keys = { finnhub: config.finnhubKey(), coingecko: config.coingeckoKey() }
    let recorded = 0
    for (const u of await db.select({ id: users.id }).from(users)) {
      const hs = await listHoldings(db, u.id)
      const r = await refreshQuotes(db, hs.map((h) => ({ symbol: h.symbol, crypto: h.assetClass === 'crypto' })), keys, { force: true })
      await refreshNews(db, hs.filter((h) => h.assetClass !== 'crypto').map((h) => h.symbol), keys.finnhub, { force: true })
      if (r.updated > 0) {
        await recordSnapshot(db, u.id, await loadOverview(db, u.id))
        recorded++
      }
    }
    return NextResponse.json({ ok: true, recorded })
  } catch (err) {
    console.error('daily job failed', err)
    return NextResponse.json({ ok: false, error: 'Job failed — see server logs' }, { status: 500 })
  }
}
