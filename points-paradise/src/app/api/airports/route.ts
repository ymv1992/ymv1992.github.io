import { NextResponse, type NextRequest } from 'next/server'
import { searchAirports } from '@/lib/geo/airports'
import { getSessionUserId } from '@/lib/server/session'

export async function GET(req: NextRequest) {
  if (!(await getSessionUserId())) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const q = (req.nextUrl.searchParams.get('q') ?? '').slice(0, 60)
  const items = searchAirports(q, 8).map((a) => ({ iata: a.iata, name: a.name, city: a.city, country: a.countryName }))
  return NextResponse.json({ items }, { headers: { 'Cache-Control': 'private, max-age=3600' } })
}
