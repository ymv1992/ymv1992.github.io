import { getDb } from '@/lib/db/client'
import { getTrip } from '@/lib/data/trips'
import { getSessionUserId } from '@/lib/server/session'
import { buildTripPdf, tripPdfFilename } from '@/lib/trips/trip-pdf'

export const dynamic = 'force-dynamic'

/** Downloads the trip as a printable PDF itinerary. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId()
  if (!userId) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: 'Not found' }, { status: 404 })
  const data = await getTrip(await getDb(), userId, id)
  if (!data) return Response.json({ error: 'Not found' }, { status: 404 })
  const pdf = await buildTripPdf(data.trip, data.items)
  return new Response(pdf as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${tripPdfFilename(data.trip)}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
