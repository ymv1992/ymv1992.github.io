import type { Metadata } from 'next'
import { saveRulesAction, saveTargetsAction } from '../../actions'
import { listTrades } from '@/lib/data/store'
import { BUCKETS, BUCKET_LABELS } from '@/lib/domain/types'
import { pct, shortDate, usd } from '@/lib/format'
import { isoDay } from '@/lib/time'
import { loadPage } from '@/lib/server/load'
import { washSaleFlags } from '@/lib/view/briefing'
import { AllocationBars } from '@/components/charts/allocation-bars'
import { ActionForm } from '@/components/forms'
import { TopCalculator } from '@/components/top-calculator'
import { Badge, Empty, Notice, PageHeader, Section } from '@/components/ui'

export const metadata: Metadata = { title: 'Diversification' }

const RULE_FIELDS = [
  ['maxSingleStockPct', 'Largest single stock or coin (%)'],
  ['maxThemePct', 'Largest single theme (%)'],
  ['minIndexPct', 'Minimum in index funds (%)'],
  ['maxSpeculativePct', 'Speculative limit (%)'],
  ['maxCryptoPct', 'Crypto limit (%)'],
] as const

export default async function StrategyPage() {
  const { db, userId, overview: o } = await loadPage()
  const s = o.summary
  const monthly = o.profile.monthlyContribution ?? 0
  const singles = s.positions.filter((p) => p.assetClass !== 'etf' && p.value != null).sort((a, b) => b.value! - a.value!)
  const top3 = singles.slice(0, 3)
  const limit = o.profile.rules.maxSingleStockPct
  const overLimit = singles.filter((p) => (p.weight ?? 0) > limit)
  const losers = s.positions.filter((p) => p.gain != null && p.gain < 0).sort((a, b) => a.gain! - b.gain!)
  const gaps = [...o.rows].filter((r) => r.gapValue > 0).sort((a, b) => b.gapValue - a.gapValue)
  const meta = new Map(o.holdings.map((h) => [h.id, h]))
  const flags = washSaleFlags(await listTrades(db, userId))
  const yearAgo = isoDay(-365)
  const term = (id: string) => {
    const d = meta.get(id)?.purchaseDate
    return !d ? 'purchase date not entered, so the holding period is unknown' : d <= yearAgo ? `held over a year (since ${shortDate(d)}): long-term rates would apply` : `held under a year (since ${shortDate(d)}): short-term rates would apply`
  }

  if (!o.holdings.length && !o.assets.some((a) => a.inPortfolio)) {
    return (
      <>
        <PageHeader title="Diversification" />
        <Empty title="Add holdings first">Your mix, rules and plan are calculated from what you own.</Empty>
      </>
    )
  }

  return (
    <>
      <PageHeader title="Diversification" subtitle="Your current mix against the targets and rules you set. Flags here are arithmetic on your own limits, not instructions to trade." />
      <div className="space-y-6">
        <Section title="Current mix against target" hint={`Based on ${usd(s.portfolioValue)} of investable assets.`}>
          <AllocationBars rows={o.rows} />
          {!o.assets.some((a) => a.category === 'retirement') && (
            <div className="mt-5">
              <Notice tone="warn">No retirement account is entered yet. If you hold index funds in a TSP, 401k or IRA, this mix understates your index share until you add it under My Portfolio.</Notice>
            </div>
          )}
        </Section>

        <div className="grid gap-6 lg:grid-cols-2">
          <Section title="My rules" hint={`Rules-followed score: ${o.health.total}/100. It measures how closely the portfolio matches your own rules and targets. It does not predict returns.`}>
            <ul className="space-y-3">
              {o.rules.map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-ink">{r.label}</p>
                    <p className="num text-xs text-muted">{r.measured}</p>
                  </div>
                  <Badge tone={r.broken ? 'danger' : 'ok'}>{r.broken ? '✕ Broken' : '✓ Within limit'}</Badge>
                </li>
              ))}
            </ul>
            <div className="hairline my-5" />
            <ul className="space-y-1.5 text-xs text-muted">
              {o.health.parts.map((p) => (
                <li key={p.label} className="flex justify-between gap-3">
                  <span>
                    {p.label}: {p.detail}
                  </span>
                  <span className="num text-ink">
                    {p.score}/{p.max}
                  </span>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Step-by-step plan" hint="Options to weigh, in the usual order of least cost first. Check tax effects before selling anything in a taxable account.">
            <ol className="space-y-4 text-sm">
              <li>
                <p className="font-medium text-ink">1. Send new money to the biggest gap</p>
                <p className="mt-1 text-muted">
                  {gaps[0] ? (
                    <>
                      Furthest below target: <span className="text-ink">{BUCKET_LABELS[gaps[0].bucket]}</span>, {pct(gaps[0].pct)} against {pct(gaps[0].targetPct, 0)}, about <span className="num text-ink">{usd(gaps[0].gapValue)}</span> short.
                      {monthly > 0 && ` At ${usd(monthly)} a month that gap takes about ${Math.ceil(gaps[0].gapValue / monthly)} months to fill, with no selling and no tax.`}
                    </>
                  ) : (
                    'No bucket is below target.'
                  )}
                </p>
              </li>
              <li>
                <p className="font-medium text-ink">2. Review positions at a loss</p>
                <p className="mt-1 text-muted">
                  {losers.length
                    ? 'Selling at a loss can offset gains for tax purposes (tax-loss harvesting), but only if you would be content not owning it for 31 days.'
                    : 'No holding is currently below its cost.'}
                </p>
                {losers.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {losers.map((p) => (
                      <li key={p.id} className="num text-xs text-muted">
                        <span className="text-ink">{p.symbol}</span> {usd(p.gain)} ({pct(p.gainPct)}) · <span className="font-sans">{term(p.id)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
              <li>
                <p className="font-medium text-ink">3. Positions above your {limit}% limit</p>
                <p className="mt-1 text-muted">{overLimit.length ? 'If you choose to trim, doing it in slices spreads out both the tax and the timing risk.' : 'No individual position is above your limit.'}</p>
                {overLimit.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {overLimit.map((p) => (
                      <li key={p.id} className="num text-xs text-muted">
                        <span className="text-ink">{p.symbol}</span> {pct(p.weight)} · {usd(p.value! - (limit / 100) * s.portfolioValue)} above the limit · <span className="font-sans">{term(p.id)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
              <li>
                <p className="font-medium text-ink">4. Check again each quarter</p>
                <p className="mt-1 text-muted">Markets move the mix on their own. A quarterly look is enough; more often tends to lead to overtrading.</p>
              </li>
            </ol>
          </Section>
        </div>

        <Section title="How long until my top 3 shrink?" hint="Shows how far regular contributions alone can dilute your largest individual positions.">
          <TopCalculator topValue={top3.reduce((a, p) => a + p.value!, 0)} total={s.portfolioValue} topSymbols={top3.map((p) => p.symbol)} defaultMonthly={monthly || 500} />
        </Section>

        <Section title="Wash-sale check" hint="If you sell at a loss and buy the same or a substantially identical security within 30 days before or after, the loss is generally disallowed for US tax purposes in taxable accounts. A tax professional can confirm how it applies to you.">
          {flags.length === 0 ? (
            <p className="text-sm text-muted">No possible wash sales found in your trade journal. Only trades you log are checked.</p>
          ) : (
            <ul className="space-y-2">
              {flags.map((f) => (
                <li key={`${f.symbol}${f.sellDate}`}>
                  <Notice tone="warn">
                    <span className="num">{f.symbol}</span>: sold at a loss of <span className="num">{usd(Math.abs(f.loss))}</span> on {shortDate(f.sellDate)} and bought on {shortDate(f.buyDate)}, within 30 days.
                  </Notice>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <div className="grid gap-6 lg:grid-cols-2">
          <Section title="Edit target mix" hint="Must total 100%.">
            <ActionForm action={saveTargetsAction} submitLabel="Save targets">
              <div className="grid grid-cols-2 gap-3">
                {BUCKETS.map((b) => (
                  <div key={b}>
                    <label className="label" htmlFor={`target_${b}`}>{BUCKET_LABELS[b]} (%)</label>
                    <input id={`target_${b}`} name={`target_${b}`} className="field num" inputMode="decimal" defaultValue={o.profile.targets[b]} />
                  </div>
                ))}
              </div>
            </ActionForm>
          </Section>
          <Section title="Edit rules">
            <ActionForm action={saveRulesAction} submitLabel="Save rules">
              <div className="grid grid-cols-2 gap-3">
                {RULE_FIELDS.map(([k, label]) => (
                  <div key={k}>
                    <label className="label" htmlFor={k}>{label}</label>
                    <input id={k} name={k} className="field num" inputMode="decimal" defaultValue={o.profile.rules[k]} />
                  </div>
                ))}
              </div>
            </ActionForm>
          </Section>
        </div>
      </div>
    </>
  )
}
