import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { deleteHoldingAction } from '../../../actions'
import { loadPage } from '@/lib/server/load'
import { pct, price, usd } from '@/lib/format'
import { ActionButton } from '@/components/forms'
import { HoldingForm } from '@/components/holding-form'
import { Delta, LinkButton, PageHeader, Section, Stat } from '@/components/ui'

export const metadata: Metadata = { title: 'Holding' }

export default async function HoldingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { overview: o } = await loadPage()
  const h = o.holdings.find((x) => x.id === id)
  const p = o.summary.positions.find((x) => x.id === id)
  if (!h || !p) notFound()
  return (
    <>
      <PageHeader eyebrow="Holding" title={h.symbol} subtitle={h.name || undefined} actions={<LinkButton href="/portfolio" variant="secondary" size="sm">Back to portfolio</LinkButton>} />
      <div className="space-y-6">
        <Section title="Position">
          <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
            <Stat label="Value" value={usd(p.value)} sub={p.valueBasis === 'cost' ? 'At cost; no price available' : p.valueBasis === 'none' ? 'Not valued' : `at ${price(p.price)}`} />
            <Stat label="Cost basis" value={usd(p.costBasis)} />
            <Stat label="Gain / loss" value={<Delta value={p.gain} />} sub={<Delta value={p.gainPct} kind="pct" />} />
            <Stat label="Share of portfolio" value={pct(p.weight)} sub={`Your single-position limit is ${o.profile.rules.maxSingleStockPct}%`} />
          </div>
        </Section>
        <Section title="Details and thesis" hint="Writing down why you own something, and what would change your mind, makes later decisions easier to judge.">
          <HoldingForm holding={h} />
        </Section>
        <ActionButton action={deleteHoldingAction} hidden={{ id: h.id }} label={`Remove ${h.symbol} from my portfolio`} variant="danger" size="md" confirm={`Remove ${h.symbol}? This cannot be undone.`} />
      </div>
    </>
  )
}
