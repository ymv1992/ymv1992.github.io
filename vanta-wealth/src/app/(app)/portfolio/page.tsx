import type { Metadata } from 'next'
import Link from 'next/link'
import { confirmHoldingAction, deleteAssetAction, refreshPricesAction } from '../../actions'
import { ASSET_CATEGORY_LABELS, ASSET_STATUS_LABELS, BUCKET_LABELS } from '@/lib/domain/types'
import { dateTime, freshness, pct, price, qty, shortDate, usd } from '@/lib/format'
import { config } from '@/lib/server/config'
import { loadPage } from '@/lib/server/load'
import { AssetForm } from '@/components/asset-form'
import { ActionButton } from '@/components/forms'
import { HoldingForm } from '@/components/holding-form'
import { ImportPanel } from '@/components/import-panel'
import { PriceStatus } from '@/components/price-status'
import { Badge, Delta, Empty, PageHeader, Section, Stat } from '@/components/ui'
import { isoDay } from '@/lib/time'

export const metadata: Metadata = { title: 'My Portfolio' }

const FRESH_TONE = { recent: 'ok', last: 'neutral', stale: 'warn', none: 'warn' } as const

export default async function PortfolioPage() {
  const { overview: o, feeds, missingSymbols, feedErrors } = await loadPage()
  const s = o.summary
  const today = isoDay()
  const positions = [...s.positions].sort((a, b) => (b.value ?? -1) - (a.value ?? -1))
  const meta = new Map(o.holdings.map((h) => [h.id, h]))
  const confirmed = positions.filter((p) => p.status === 'confirmed')
  const unverified = positions.filter((p) => p.status !== 'confirmed')

  const table = (rows: typeof positions) => (
    <div className="-mx-5 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-[820px] text-sm">
        <thead>
          <tr className="eyebrow border-b border-line text-right">
            <th className="py-2 pr-3 pl-5 text-left font-semibold sm:pl-0">Holding</th>
            <th className="px-3 py-2 font-semibold">Quantity</th>
            <th className="px-3 py-2 font-semibold">Avg cost</th>
            <th className="px-3 py-2 font-semibold">Price</th>
            <th className="px-3 py-2 font-semibold">Value</th>
            <th className="px-3 py-2 font-semibold">Gain / loss</th>
            <th className="px-3 py-2 font-semibold">Today</th>
            <th className="py-2 pr-5 pl-3 font-semibold sm:pr-0">Share</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((p) => {
            const q = o.quotes.get(p.symbol)
            const f = freshness(q?.quoteTime, q?.fetchedAt)
            const h = meta.get(p.id)!
            return (
              <tr key={p.id} className="text-right align-top">
                <td className="py-3 pr-3 pl-5 text-left sm:pl-0">
                  <Link href={`/portfolio/${p.id}`} className="num font-medium text-ink underline-offset-2 hover:underline">
                    {p.symbol}
                  </Link>
                  <p className="max-w-52 truncate text-xs text-muted">{p.name || BUCKET_LABELS[p.bucket]}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-1">
                    <Badge>{BUCKET_LABELS[p.bucket]}</Badge>
                    {missingSymbols.includes(p.symbol) && <Badge tone="danger">No price found — check ticker</Badge>}
                    {p.status !== 'confirmed' && <ActionButton action={confirmHoldingAction} hidden={{ id: p.id }} label="Mark confirmed" variant="ghost" />}
                  </p>
                </td>
                <td className="num px-3 py-3">
                  {qty(p.quantity)}
                  <p className="text-[11px] text-faint">as of {shortDate(h.asOf)}</p>
                </td>
                <td className="num px-3 py-3">{p.avgCost == null ? <span className="text-faint">unknown</span> : price(p.avgCost)}</td>
                <td className="num px-3 py-3">
                  {price(p.price)}
                  <p className="mt-0.5">
                    <Badge tone={FRESH_TONE[f.level]} title={q ? `${q.source} · price time ${dateTime(q.quoteTime)} · fetched ${dateTime(q.fetchedAt)}` : 'No price received'}>
                      {f.label}
                    </Badge>
                  </p>
                  {q && <p className="text-[11px] text-faint">{dateTime(q.quoteTime ?? q.fetchedAt)}</p>}
                </td>
                <td className="num px-3 py-3 text-ink">
                  {usd(p.value)}
                  {p.valueBasis === 'cost' && <p className="text-[11px] text-warn">at cost</p>}
                  {p.valueBasis === 'none' && <p className="text-[11px] text-warn">not valued</p>}
                </td>
                <td className="px-3 py-3">
                  <Delta value={p.gain} />
                  <p className="text-xs">
                    <Delta value={p.gainPct} kind="pct" />
                  </p>
                </td>
                <td className="px-3 py-3">
                  <Delta value={p.dayChange} />
                </td>
                <td className="num py-3 pr-5 pl-3 sm:pr-0">{pct(p.weight)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )

  return (
    <>
      <PageHeader title="My Portfolio" subtitle="What you own and how it is performing. Values come from your records and the latest prices received." actions={o.holdings.length ? <ActionButton action={refreshPricesAction} label="Refresh prices" pendingLabel="Refreshing…" /> : undefined} />
      <div className="space-y-6">
        {o.holdings.length > 0 && (
          <Section title="Summary">
            <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
              <Stat label="Holdings value" value={usd(s.holdingsValue)} />
              <Stat label="Cost basis" value={usd(s.costBasis)} />
              <Stat label="Unrealized gain" value={<Delta value={s.unrealizedGain} />} sub={<Delta value={s.unrealizedGainPct} kind="pct" />} />
              <Stat label="Today" value={<Delta value={s.dayChange} />} sub={<Delta value={s.dayChangePct} kind="pct" />} />
            </div>
            <div className="mt-5">
              <PriceStatus feeds={feeds} priced={s.pricedCount} total={o.holdings.length} finnhub={!!config.finnhubKey()} errors={feedErrors} />
            </div>
          </Section>
        )}

        <Section title="Confirmed holdings" hint="Checked against your account. Select a symbol to edit it or record why you own it.">
          {confirmed.length ? table(confirmed) : <Empty title="No confirmed holdings yet">Import below, or mark unverified holdings as confirmed once you have checked them.</Empty>}
        </Section>

        {unverified.length > 0 && (
          <Section title="Unverified historical holdings" hint="Reconciliation required. These are included in totals but flagged until you confirm them against a statement. Tickers can change through renames, splits, mergers and delistings.">
            {table(unverified)}
          </Section>
        )}

        <Section id="assets" title="Other accounts and assets" hint="Retirement accounts, cash, property and business interests. Property and business equity count toward net worth only, never toward liquid assets or the investable portfolio.">
          {o.assets.length > 0 && (
            <ul className="mb-5 divide-y divide-line">
              {o.assets.map((a) => (
                <li key={a.id} className="py-3 first:pt-0">
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3">
                      <span>
                        <span className="text-sm font-medium text-ink">{a.name}</span>
                        <span className="ml-2 text-xs text-muted">{ASSET_CATEGORY_LABELS[a.category]}</span>
                        <span className="mt-1 flex flex-wrap gap-1">
                          <Badge tone={a.status === 'verified' ? 'ok' : a.status === 'needs_input' ? 'danger' : 'warn'}>{ASSET_STATUS_LABELS[a.status]}</Badge>
                          <Badge>{a.inPortfolio ? `In portfolio${a.bucket ? ` · ${BUCKET_LABELS[a.bucket]}` : ' · no bucket'}` : 'Net worth only'}</Badge>
                          <Badge>as of {shortDate(a.asOf)}</Badge>
                        </span>
                      </span>
                      <span className="text-right">
                        <span className="num text-sm text-ink">{a.value == null ? 'Enter value' : usd(a.value)}</span>
                        {a.liability > 0 && <span className="num block text-xs text-muted">debt {usd(a.liability)}</span>}
                      </span>
                    </summary>
                    <div className="mt-4 space-y-3 rounded-xl bg-surface-2 p-4">
                      <AssetForm asset={a} today={today} />
                      <ActionButton action={deleteAssetAction} hidden={{ id: a.id }} label="Remove this asset" variant="danger" confirm={`Remove ${a.name}?`} />
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
          <div className={o.assets.length ? 'border-t border-line pt-5' : ''}>
            <p className="mb-3 text-sm font-medium text-gold">Add an account or asset</p>
            <AssetForm today={today} />
          </div>
        </Section>

        <Section id="import" title="Import holdings" hint="Nothing is saved until you review the preview and confirm. Existing holdings are never overwritten unless you tick the box to replace them.">
          <ImportPanel today={today} />
        </Section>

        <Section title="Add one holding">
          <HoldingForm />
        </Section>
      </div>
    </>
  )
}
