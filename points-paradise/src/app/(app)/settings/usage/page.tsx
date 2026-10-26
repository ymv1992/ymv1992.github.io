import type { Metadata } from 'next'
import Link from 'next/link'
import { getDb } from '@/lib/db/client'
import { loadAccount } from '@/lib/data/account'
import { listWatches } from '@/lib/data/watchlists'
import { usageSummary } from '@/lib/data/usage'
import { isStale } from '@/lib/engine/status'
import { dateTime, usd } from '@/lib/format'
import { getEvaluation } from '@/lib/server/loaders'
import { Badge, Card, PageHeader, SectionTitle, Stat } from '@/components/ui'

export const metadata: Metadata = { title: 'Usage' }

export default async function UsagePage() {
  const data = await getEvaluation()
  const db = await getDb()
  const { settings } = await loadAccount(db, data.userId)
  const usage = await usageSummary(db)
  const watches = await listWatches(db, data.userId)
  const now = data.ctx.now
  const tz = settings.timezone
  const spend = usage.byProvider.reduce((s, p) => s + Number(p.cost), 0)
  const aiSpend = Number(usage.byProvider.find((p) => p.provider === 'anthropic')?.cost ?? 0)
  const searches = usage.byProvider.filter((p) => p.provider !== 'anthropic').reduce((s, p) => s + Number(p.requests), 0)
  const failed = usage.byProvider.reduce((s, p) => s + Number(p.failed), 0)
  const stale = data.items.filter((i) => i.deal.sourceKind !== 'demo' && i.deal.lastVerifiedAt && isStale(i.deal.lastVerifiedAt, now, 24)).length
  const nextChecks = watches
    .filter((w) => w.active && w.autoCheckSupported)
    .map((w) => ({ w, next: w.lastCheckedAt ? new Date(w.lastCheckedAt.getTime() + w.refreshHours * 3_600_000) : now }))
    .sort((a, b) => a.next.getTime() - b.next.getTime())
    .slice(0, 10)

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Settings" title="Usage & costs" subtitle={`Since ${usage.since.toISOString().slice(0, 10)} (UTC month). Paid requests pause automatically before a cap is reached.`} actions={<Link href="/settings#budgets" className="rounded-full border border-line bg-surface px-4 py-2 text-sm">Edit budgets</Link>} />
      <Card className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-5">
        <Stat label="Data searches" value={searches.toLocaleString('en-US')} />
        <Stat label="Estimated spend" value={usd(spend, { cents: true })} hint={`cap ${usd(settings.monthlyApiBudgetUsd)} data + ${usd(settings.aiMonthlyBudgetUsd)} AI`} />
        <Stat label="Data budget left" value={usd(Math.max(0, settings.monthlyApiBudgetUsd - (spend - aiSpend)), { cents: true })} />
        <Stat label="Failed jobs" value={failed} />
        <Stat label="Stale results" value={stale} hint="verified over 2 days ago" />
      </Card>
      <Card className="p-5">
        <SectionTitle>By provider</SectionTitle>
        {usage.byProvider.length === 0 ? (
          <p className="text-sm text-muted">No provider requests this month.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-faint">
              <tr>
                <th className="py-1 font-medium">Provider</th>
                <th className="py-1 font-medium">Jobs</th>
                <th className="py-1 font-medium">Requests</th>
                <th className="py-1 font-medium">Failed</th>
                <th className="py-1 font-medium">Skipped</th>
                <th className="py-1 text-right font-medium">Est. cost</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {usage.byProvider.map((p) => (
                <tr key={p.provider} className="border-t border-line">
                  <td className="py-2">{p.provider}</td>
                  <td className="py-2">{p.jobs}</td>
                  <td className="py-2">{p.requests}</td>
                  <td className="py-2">{p.failed}</td>
                  <td className="py-2">{p.skipped}</td>
                  <td className="py-2 text-right">{usd(Number(p.cost), { cents: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card className="p-5">
        <SectionTitle>Next scheduled checks</SectionTitle>
        {nextChecks.length === 0 ? (
          <p className="text-sm text-muted">No automatic checks scheduled. Watches only re-check automatically when a permitted provider (e.g. seats.aero) is configured.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {nextChecks.map(({ w, next }) => (
              <li key={w.id} className="flex justify-between gap-3 py-2">
                <span>{w.label}</span>
                <span className="text-muted">{next <= now ? 'Due now' : dateTime(next, tz)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="p-5">
        <SectionTitle>Recent jobs</SectionTitle>
        <ul className="divide-y divide-line text-sm">
          {usage.recent.length === 0 && <li className="py-2 text-muted">No jobs have run yet.</li>}
          {usage.recent.map((j) => (
            <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <strong>{j.provider}</strong> · {j.jobType}{' '}
                <Badge tone={j.status === 'succeeded' ? 'ok' : j.status === 'failed' ? 'danger' : 'warn'}>{j.status.replace(/_/g, ' ')}</Badge>
                {(j.provider === 'seats_aero' || j.provider === 'rooms_aero') && j.status === 'succeeded' && <SearchCounts params={j.params} kept={j.resultsCount} />}
                {j.error && <span className="block text-xs text-danger">{j.error}</span>}
              </span>
              <span className="tabular text-xs text-muted">
                {dateTime(j.createdAt, tz)} · {j.requestCount} req · {usd(j.estimatedCostUsd, { cents: true })}
                {j.durationMs != null && ` · ${j.durationMs} ms`}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}

/** What a seats.aero answer contained, so an empty-looking search can be explained. */
function SearchCounts({ params, kept }: { params: Record<string, unknown>; kept: number }) {
  if (typeof params.returned !== 'number') return null
  const unreadable = typeof params.unreadable === 'number' ? params.unreadable : 0
  const sources = Array.isArray(params.sources) ? params.sources.join(', ') : ''
  return (
    <span className="block text-xs text-muted">
      {params.returned} returned{unreadable ? `, ${unreadable} unreadable` : ''} · {kept} kept
      {sources ? ` · programs: ${sources}` : ''}
      {typeof params.firstIssue === 'string' && <span className="block text-danger">Unreadable because: {params.firstIssue}</span>}
      {typeof params.sample === 'string' && <code className="mt-1 block break-all rounded bg-surface-2 p-1.5 text-[11px]">{params.sample}</code>}
    </span>
  )
}
