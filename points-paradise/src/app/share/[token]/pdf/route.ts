import { getDb } from '@/lib/db/client'
import { getSharedTrip } from '@/lib/data/trips'
import { buildTripPdf, tripPdfFilename } from '@/lib/trips/trip-pdf'

export const dynamic = 'force-dynamic'

/** PDF of a shared trip, for whoever has the link. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const data = await getSharedTrip(await getDb(), token)
  if (!data) return Response.json({ error: 'This link is no longer shared' }, { status: 404 })
  // Confirmation numbers stay out of shared copies.
  const pdf = await buildTripPdf(data.trip, data.items, new Date(), { hideConfirmation: true })
  return new Response(pdf as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${tripPdfFilename(data.trip)}"`,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
    },
  })
}
