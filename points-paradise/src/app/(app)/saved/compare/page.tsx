import type { Metadata } from 'next'
import Link from 'next/link'
import { CABIN_LABELS, ROOM_TYPE_LABELS, SEAT_TYPE_LABELS } from '@/lib/domain/constants'
import { cpp, dateRange, minutesLabel, points, usd } from '@/lib/format'
import { getEvaluationWithArchive } from '@/lib/server/loaders'
import { availabilityRisk } from '@/lib/view/deal-view'
import { Badge, PageHeader, StatusBadge } from '@/components/ui'

export const metadata: Metadata = { title: 'Compare deals' }

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const { ids } = await searchParams
  const data = await getEvaluationWithArchive()
  const items = (ids ?? '')
    .split(',')
    .map((id) => data.byId.get(id.trim()))
    .filter((x) => x !== undefined)
    .slice(0, 4)
  const balance = data.account.wallet.chaseBalance
  const maxCash = data.account.profile.maxCashUsd

  if (items.length < 2) {
    return (
      <div>
        <PageHeader title="Compare deals" />
        <p className="text-sm text-muted">
          Select two to four deals on the <Link href="/saved" className="text-primary underline">Saved</Link> page to compare them.
        </p>
      </div>
    )
  }
  const bestCpp = Math.max(...items.map((i) => i.valuation.practicalCpp ?? -1))
  const rows: { label: string; render: (i: (typeof items)[number]) => React.ReactNode }[] = [
    { label: 'Evidence', render: (i) => (i.deal.sourceKind === 'demo' ? <Badge tone="gold">DEMO</Badge> : <StatusBadge status={i.status} />) },
    { label: 'Provider', render: (i) => i.deal.providerName },
    { label: 'Dates', render: (i) => dateRange(i.deal.travelStart, i.deal.travelEnd) },
    { label: 'Product', render: (i) => (i.deal.flight ? `${CABIN_LABELS[i.deal.flight.cabin]} · ${SEAT_TYPE_LABELS[i.deal.flight.seatType]}` : i.deal.hotel ? (i.deal.hotel.roomCategory ?? ROOM_TYPE_LABELS[i.deal.hotel.roomType]) : i.deal.kind) },
    { label: 'Chase points', render: (i) => points(i.valuation.chasePoints) },
    { label: 'Cash required', render: (i) => usd(i.deal.mandatoryCashUsd) },
    { label: 'Comparable cash', render: (i) => usd(i.deal.comparableCashUsd) },
    {
      label: 'Value per point',
      render: (i) => (
        <span className={i.valuation.practicalCpp === bestCpp ? 'font-semibold text-primary' : undefined}>
          {i.valuation.calculable ? cpp(i.valuation.practicalCpp) : 'Not calculable'}
        </span>
      ),
    },
    { label: 'Confidence', render: (i) => i.valuation.confidence },
    { label: 'Fits your points', render: (i) => (i.valuation.chasePoints != null && i.valuation.chasePoints <= balance ? 'Yes' : 'No') },
    { label: 'Fits your cash budget', render: (i) => ((i.deal.mandatoryCashUsd ?? Infinity) <= maxCash ? 'Yes' : 'No') },
    { label: 'Duration / nights', render: (i) => (i.deal.flight ? minutesLabel(i.deal.flight.durationMinutes) : i.deal.nights != null ? `${i.deal.nights} nights` : '—') },
    { label: 'Deadline', render: (i) => i.deadline.headline },
    { label: 'Availability risk', render: (i) => availabilityRisk(i).label },
    { label: 'Personal match', render: (i) => `${i.match.score}/100` },
    { label: 'Warnings', render: (i) => (i.valuation.flags.length ? i.valuation.flags.map((f) => f.message).join(' ') : 'None') },
  ]
  return (
    <div>
      <PageHeader title="Compare deals" actions={<Link href="/saved" className="rounded-full border border-line bg-surface px-4 py-2 text-sm">Back to Saved</Link>} />
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              <th scope="col" className="w-40 p-3 text-xs font-medium text-faint">
                Deal
              </th>
              {items.map((i) => (
                <th key={i.deal.id} scope="col" className="p-3 align-bottom">
                  <Link href={`/deals/${i.deal.id}`} className="font-display text-lg hover:text-primary">
                    {i.deal.destination.city}
                  </Link>
                  <div className="text-xs font-normal text-muted">{i.deal.destination.country}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular">
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-line last:border-0">
                <th scope="row" className="p-3 text-left text-xs font-medium text-faint">
                  {r.label}
                </th>
                {items.map((i) => (
                  <td key={i.deal.id} className="p-3 align-top">
                    {r.render(i)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
