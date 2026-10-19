import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { dealToFormValues } from '@/lib/data/deal-input'
import { getEvaluationWithArchive } from '@/lib/server/loaders'
import { toZonedLocalInput } from '@/lib/time'
import { programOptions } from '@/lib/view/programs'
import { DealForm } from '@/components/deal/deal-form'
import { Notice, PageHeader } from '@/components/ui'

export const metadata: Metadata = { title: 'Edit deal' }

export default async function EditDealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await getEvaluationWithArchive()
  const e = data.byId.get(id)
  if (!e) notFound()
  if (e.deal.sourceKind === 'demo' || e.deal.sourceKind === 'api') {
    return (
      <div>
        <PageHeader title="Edit deal" />
        <Notice tone="warn">{e.deal.sourceKind === 'demo' ? 'Demo deals are fictional and cannot be edited.' : 'Deals from data providers are updated by their source and cannot be edited.'}</Notice>
      </div>
    )
  }
  const initial = dealToFormValues(e.deal)
  if (e.deal.deadline.type === 'confirmed' && e.deal.deadline.at) {
    initial.deadlineAt = toZonedLocalInput(e.deal.deadline.at, e.deal.deadline.timezone ?? data.account.settings.timezone)
  }
  return (
    <div>
      <PageHeader eyebrow="Edit deal" title={e.deal.title} subtitle="Saving records a new price observation in this deal's history." />
      <DealForm dealId={e.deal.id} programs={programOptions(data.partners.values())} initial={initial} />
    </div>
  )
}
