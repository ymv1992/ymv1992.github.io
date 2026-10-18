import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db/client'
import { unreadNotifications } from '@/lib/data/notifications'
import { getSessionUserId } from '@/lib/server/session'

export const dynamic = 'force-dynamic'

export async function GET() {
  const userId = await getSessionUserId()
  if (!userId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const items = await unreadNotifications(await getDb(), userId)
  return NextResponse.json(
    { items: items.map((n) => ({ ...n, createdAt: n.createdAt.toISOString() })) },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
