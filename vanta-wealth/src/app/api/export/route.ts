import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db/client'
import { exportAll } from '@/lib/data/store'
import { getSessionUserId } from '@/lib/server/session'
import { isoDay } from '@/lib/time'

export const dynamic = 'force-dynamic'

/** Downloads everything stored about the owner as JSON. */
export async function GET() {
  const userId = await getSessionUserId()
  if (!userId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const data = await exportAll(await getDb(), userId)
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="vanta-wealth-export-${isoDay()}.json"`,
      'Cache-Control': 'no-store',
    },
  })
}
