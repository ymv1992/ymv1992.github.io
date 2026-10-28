import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db/client'
import { exportUserData } from '@/lib/data/privacy'
import { getViewer } from '@/lib/server/session'

export const dynamic = 'force-dynamic'

/** Downloads everything stored about the owner as JSON. */
export async function GET() {
  const viewer = await getViewer()
  if (!viewer) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  if (viewer.guest) return NextResponse.json({ error: 'Guest passes cannot download data' }, { status: 403 })
  const data = await exportUserData(await getDb(), viewer.userId)
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="points-paradise-export-${new Date().toISOString().slice(0, 10)}.json"`,
      'Cache-Control': 'no-store',
    },
  })
}
