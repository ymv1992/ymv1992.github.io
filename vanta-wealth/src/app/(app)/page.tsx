import type { Metadata } from 'next'
import Link from 'next/link'
import { refreshPricesAction } from '../actions'
import { listSnapshots, loadNews, realizedGainTotal } from '@/lib/data/store'
import { BUCKET_LABELS } from '@/lib/domain/types'
import { pct, shortDate, usd } from '@/lib/format'
import { config } from '@/lib/server/config'
import { loadPage } from '@/lib/server/load'
import { buildBriefing } from '@/lib/view/briefing'
import { AllocationBars } from '@/components/charts/allocation-bars'
import { LineChart } from '@/components/charts/line-chart'
import { ActionButton } from '@/components/forms'
import { PriceStatus } from '@/components/price-status'
import { Badge, Card, Delta, Empty, LinkButton, PageHeader, Section, Stat } from '@/components/ui'
import { isoDay } from '@/lib/time'

export const metadata: Metadata = { title: 'Command Center' }

const LEVEL = { action: { tone: 'danger', label: 'Needs attention' }, watch: { tone: 'warn', label: 'Watch' }, info: { tone: 'neutral', label: 'Note' } } as const

function Progress({ label, value, target }: { label: string; value: number; target: number }) {
  const p = Math.min(100, (value / target) * 100)
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-ink">{label}</span>
        <span className="num text-sm text-ink">{pct(p, p < 10 ? 1 : 0)}</span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-surface-2" role="img" aria-label={`${label}: ${pct(p, 1)} complete`}>
        <div className="h-full rounded-full bg-gold" style={{ width: `${p}%`, minWidth: p > 0 ? 4 : 0 }} />
      </div>
      <p className="num mt-1.5 text-xs text-muted">
        {usd(value)} of {usd(target)} · {usd(Math.max(0, target - value))} to go
      </p>
    </div>
  )
}

export default async function CommandCenter() {
  const { db, userId, overview: o, feeds, missingSymbols, feedErrors } = await loadPage()
  const s = o.summary
  const finnhub = !!config.finnhubKey()
  const stockSymbols = o.holdings.filter((h) => h.assetClass !== 'crypto').map((h) => h.symbol)
  const [{ earnings }, snaps, realized] = await Promise.all([loadNews(db, stockSymbols), listSnapshots(db, userId), realizedGainTotal(db, userId)])
  const today = isoDay()
  const briefing = buildBriefing(o, { finnhub, missingSymbols, earnings, today })
  const top = [...s.positions].filter((p) => p.weight != null).sort((a, b) => b.weight! - a.weight!).slice(0, 5)
  const hasData = o.holdings.length > 0 || o.assets.length > 0
  const reported = o.profile.reportedPortfolio

  return (
    <>
      <PageHeader
        eyebrow={new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })}
        title="Command Center"
        actions={hasData ? <ActionButton action={refreshPricesAction} label="Refresh prices" pendingLabel="Refreshing…" /> : undefined}
      />

      {!hasData ? (
        <Card className="p-8">
          <Empty title="Your command center is empty">
            <p>Nothing here is pre-filled or simulated. Add what you own and every figure on this page will be calculated from it.</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <LinkButton href="/portfolio#import">Import holdings</LinkButton>
              <LinkButton href="/settings" variant="secondary">
                Set up profile
              </LinkButton>
            </div>
          </Empty>
        </Card>
      ) : (
        <div className="space-y-6">
          <Card className="p-5 sm:p-7">
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr]">
              <div>
                <p className="eyebrow">Investable portfolio</p>
                <p className="num mt-1 text-4xl text-ink sm:text-5xl">{usd(s.portfolioValue)}</p>
                <p className="mt-2 text-sm">
                  <Delta value={s.dayChange} /> <Delta value={s.dayChangePct} kind="pct" className="ml-1" /> <span className="text-xs text-muted">since previous close</span>
                </p>
                {(s.atCostCount > 0 || s.unvaluedCount > 0) && (
                  <p className="mt-2 text-xs text-warn">
                    {s.atCostCount > 0 && `${s.atCostCount} holding${s.atCostCount > 1 ? 's' : ''} counted at cost because no price is available. `}
                    {s.unvaluedCount > 0 && `${s.unvaluedCount} left out because neither a price nor a cost is known.`}
                  </p>
                )}
              </div>
              <Stat label="Net worth" value={usd(o.netWorth)} sub={`Portfolio plus other assets, minus ${usd(o.liabilities)} of debt`} />
              <Stat label="Liquid assets" value={usd(o.liquid)} sub={o.realEstateEquity ? `Excludes ${usd(o.realEstateEquity)} of property equity` : 'Holdings plus cash you marked liquid'} />
            </div>
            <div className="hairline my-6" />
            <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
              <Stat label="Unrealized gain" value={<Delta value={s.unrealizedGain} />} sub={<Delta value={s.unrealizedGainPct} kind="pct" />} />
              <Stat label="Cost basis" value={usd(s.costBasis)} sub="Where average cost is known" />
              <Stat label="Realized gain" value={<Delta value={realized.realized} />} sub={`From sells in your journal · dividends ${usd(realized.dividends)}`} />
              <Stat label="Rules followed" value={`${o.health.total}/100`} sub={<Link href="/strategy" className="underline underline-offset-2">How this is scored</Link>} />
            </div>
            <div className="mt-6">
              <PriceStatus feeds={feeds} priced={s.pricedCount} total={o.holdings.length} finnhub={finnhub} errors={feedErrors} />
            </div>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Today's briefing" hint="Built from rules applied to your own records. Routine movement is left out.">
              {briefing.length === 0 ? (
                <p className="text-sm text-muted">Nothing needs your attention today.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {briefing.map((b) => (
                    <li key={b.title} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={LEVEL[b.level].tone}>{LEVEL[b.level].label}</Badge>
                        {b.href ? (
                          <Link href={b.href} className="text-sm font-medium text-ink underline-offset-2 hover:underline">
                            {b.title}
                          </Link>
                        ) : (
                          <span className="text-sm font-medium text-ink">{b.title}</span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-muted">{b.detail}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Progress to your milestones" hint="Investable portfolio only. Property equity is not counted.">
              <div className="space-y-6">
                <Progress label="First $1,000,000" value={s.portfolioValue} target={1_000_000} />
                <Progress label="$5,000,000" value={s.portfolioValue} target={5_000_000} />
              </div>
              {reported != null && (
                <p className="mt-5 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
                  You reported about <span className="num text-ink">{usd(reported)}</span> in total investments{o.profile.reportedPortfolioAsOf ? ` as of ${shortDate(o.profile.reportedPortfolioAsOf)}` : ''} (unverified). Tracked here:{' '}
                  <span className="num text-ink">{usd(s.portfolioValue)}</span>.{' '}
                  {reported > s.portfolioValue ? `About ${usd(reported - s.portfolioValue)} is not yet entered as a holding or account. The reported figure is never added on top of tracked holdings.` : 'Tracked holdings now cover the reported figure.'}
                </p>
              )}
              <div className="mt-5">
                <LinkButton href="/roadmap" variant="secondary" size="sm">
                  Open the Millionaire Roadmap
                </LinkButton>
              </div>
            </Section>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Mix against your targets" actions={<LinkButton href="/strategy" variant="ghost" size="sm">Details</LinkButton>}>
              <AllocationBars rows={o.rows} compact />
              {s.unbucketed > 0 && <p className="mt-3 text-xs text-warn">{usd(s.unbucketed)} of portfolio assets have no bucket assigned.</p>}
            </Section>
            <Section title="Largest positions" actions={<LinkButton href="/portfolio" variant="ghost" size="sm">All holdings</LinkButton>}>
              {top.length === 0 ? (
                <p className="text-sm text-muted">No valued holdings yet.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {top.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="num text-sm font-medium text-ink">{p.symbol}</p>
                        <p className="truncate text-xs text-muted">{p.name || BUCKET_LABELS[p.bucket]}</p>
                      </div>
                      <div className="text-right">
                        <p className="num text-sm text-ink">{usd(p.value)}</p>
                        <p className="num text-xs text-muted">{pct(p.weight)} of portfolio</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>

          <Section title="Portfolio value over time" hint="Recorded once a day from the day you started using this app. Earlier history is not reconstructed.">
            {snaps.length < 2 ? (
              <p className="text-sm text-muted">{snaps.length === 0 ? 'The first value is recorded as soon as prices are available.' : `First value recorded ${shortDate(snaps[0]!.day)}. The chart appears once a second day is recorded.`}</p>
            ) : (
              <LineChart
                ariaLabel="Recorded portfolio value by day"
                xLabels={snaps.map((x) => shortDate(x.day))}
                series={[
                  { key: 'v', label: 'Portfolio value', values: snaps.map((x) => x.portfolioValue), style: 'solid' },
                  ...(snaps.every((x) => x.costBasis != null) ? [{ key: 'c', label: 'Cost basis', values: snaps.map((x) => x.costBasis!), style: 'dashed' as const }] : []),
                ]}
              />
            )}
          </Section>
        </div>
      )}
    </>
  )
}
