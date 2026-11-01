import type { Metadata } from 'next'
import { getDb } from '@/lib/db/client'
import { loadAccount } from '@/lib/data/account'
import { integrationStatus } from '@/lib/server/config'
import { requireUserId } from '@/lib/server/session'
import { WeekendForm } from '@/components/weekends/weekend-form'
import { Card, PageHeader } from '@/components/ui'

export const metadata: Metadata = { title: 'Weekend getaways' }
// One search checks every destination group both ways.
export const maxDuration = 60

export default async function WeekendsPage() {
  const userId = await requireUserId()
  const { profile } = await loadAccount(await getDb(), userId)
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Discover" title="Weekend getaways" subtitle="Where you can go on points over the coming weekends: out Thursday or Friday, back Sunday or Monday, cheapest first." />
      <Card className="p-5">
        {integrationStatus().seatsAero ? (
          <WeekendForm defaults={{ origin: profile.homeAirports[0] ?? 'LAX' }} homeAirports={profile.homeAirports} />
        ) : (
          <p className="text-sm text-muted">Weekend search needs the seats.aero Pro API key (see Settings → Data sources).</p>
        )}
      </Card>
    </div>
  )
}
