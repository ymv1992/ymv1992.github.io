import type { Metadata } from 'next'
import Link from 'next/link'
import { getEvaluation } from '@/lib/server/loaders'
import { programOptions } from '@/lib/view/programs'
import { DealForm } from '@/components/deal/deal-form'
import { PageHeader } from '@/components/ui'

export const metadata: Metadata = { title: 'Add a deal' }

export default async function NewDealPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const data = await getEvaluation()
  // Optional prefill from other pages (e.g. a watch or an idea): only known simple fields.
  const initial: Record<string, string> = {
    kind: sp.kind === 'hotel' || sp.kind === 'package' || sp.kind === 'experience' ? sp.kind : 'flight',
    originAirport: sp.from ?? data.account.profile.homeAirports[0] ?? '',
    destAirport: sp.to ?? '',
    destCity: sp.city ?? '',
    destCountry: sp.country ?? '',
    programId: sp.program ?? '',
    comparableCashSource: 'owner_observed',
    availability: 'unknown',
    deadlineType: 'none',
    deadlineTimezone: data.account.settings.timezone,
    sourceUrl: sp.sourceUrl && /^https?:\/\//i.test(sp.sourceUrl) ? sp.sourceUrl.slice(0, 2000) : '',
    sourceName: sp.sourceName?.slice(0, 120) ?? '',
    whyNoteworthy: sp.note?.slice(0, 600) ?? '',
  }
  return (
    <div>
      <PageHeader
        eyebrow="Add a deal"
        title="Record a deal you found"
        subtitle="Manual entry works without any paid data provider. Every number you enter is shown with its source and timestamp."
        actions={
          <Link href="/deals/import" className="rounded-full border border-line bg-surface px-4 py-2 text-sm">
            Import JSON / CSV
          </Link>
        }
      />
      <DealForm dealId={null} programs={programOptions(data.partners.values())} initial={initial} />
    </div>
  )
}
