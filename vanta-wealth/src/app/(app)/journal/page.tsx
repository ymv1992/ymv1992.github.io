import type { Metadata } from 'next'
import Link from 'next/link'
import { addNoteAction, addTradeAction, addWatchAction, deleteNoteAction, deleteTradeAction, deleteWatchAction } from '../../actions'
import { listNotes, listTrades, listWatchlist, loadQuotes, realizedGainTotal } from '@/lib/data/store'
import { freshness, price, qty, shortDate, usd } from '@/lib/format'
import { loadPage } from '@/lib/server/load'
import { ActionButton, ActionForm } from '@/components/forms'
import { Badge, Delta, Empty, LinkButton, PageHeader, Section, Stat } from '@/components/ui'
import { isoDay } from '@/lib/time'

export const metadata: Metadata = { title: 'Trade Journal' }

const TABS = [
  ['trades', 'Trade log'],
  ['theses', 'Holdings & theses'],
  ['watchlist', 'Watchlist'],
  ['notes', 'My notes'],
] as const

export default async function JournalPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { db, userId, overview: o } = await loadPage()
  const requested = (await searchParams).tab
  const tab = TABS.find(([k]) => k === requested)?.[0] ?? 'trades'
  const today = isoDay()

  return (
    <>
      <PageHeader title="Trade Journal" subtitle="A record of what you did and why, so later decisions can be judged against the reasoning at the time." />
      <div className="mb-6 flex flex-wrap gap-1.5">
        {TABS.map(([k, label]) => (
          <LinkButton key={k} href={`/journal?tab=${k}`} size="sm" variant={tab === k ? 'primary' : 'secondary'}>
            {label}
          </LinkButton>
        ))}
      </div>
      {tab === 'trades' && <Trades db={db} userId={userId} today={today} />}
      {tab === 'theses' && (
        <Section title="Holdings & theses" hint="Why you own each holding and what would make you sell or trim. Select a symbol to write or update it.">
          {o.holdings.length === 0 ? (
            <Empty title="No holdings yet" />
          ) : (
            <ul className="divide-y divide-line">
              {o.holdings.map((h) => (
                <li key={h.id} className="py-3 first:pt-0">
                  <Link href={`/portfolio/${h.id}`} className="num text-sm font-medium text-ink underline-offset-2 hover:underline">
                    {h.symbol}
                  </Link>
                  {!h.thesis && !h.sellCondition ? (
                    <p className="mt-1 text-sm text-faint">No thesis written yet.</p>
                  ) : (
                    <div className="mt-1 grid gap-2 text-sm text-muted sm:grid-cols-2">
                      <p>
                        <span className="eyebrow block">Thesis</span>
                        {h.thesis || '—'}
                      </p>
                      <p>
                        <span className="eyebrow block">Sell or trim if</span>
                        {h.sellCondition || '—'}
                      </p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
      {tab === 'watchlist' && <Watch db={db} userId={userId} owned={new Set(o.holdings.map((h) => h.symbol))} />}
      {tab === 'notes' && <Notes db={db} userId={userId} today={today} />}
    </>
  )
}

type Db = Awaited<ReturnType<typeof loadPage>>['db']

async function Trades({ db, userId, today }: { db: Db; userId: string; today: string }) {
  const [trades, totals] = await Promise.all([listTrades(db, userId), realizedGainTotal(db, userId)])
  return (
    <div className="space-y-6">
      <Section title="Log a trade or dividend">
        <ActionForm action={addTradeAction} submitLabel="Add to journal">
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <div>
              <label className="label" htmlFor="tradeDate">Date</label>
              <input id="tradeDate" name="tradeDate" type="date" className="field num" defaultValue={today} required />
            </div>
            <div>
              <label className="label" htmlFor="t-symbol">Symbol</label>
              <input id="t-symbol" name="symbol" className="field num uppercase" required maxLength={12} />
            </div>
            <div>
              <label className="label" htmlFor="type">Type</label>
              <select id="type" name="type" className="field">
                <option value="buy">Buy</option>
                <option value="sell">Sell</option>
                <option value="dividend">Dividend</option>
                <option value="fee">Fee</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="t-qty">Quantity</label>
              <input id="t-qty" name="quantity" className="field num" inputMode="decimal" />
            </div>
            <div>
              <label className="label" htmlFor="t-price">Price (or dividend $)</label>
              <input id="t-price" name="price" className="field num" inputMode="decimal" />
            </div>
            <div>
              <label className="label" htmlFor="t-fees">Fees</label>
              <input id="t-fees" name="fees" className="field num" inputMode="decimal" />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="label" htmlFor="thesis">Why (thesis)</label>
              <textarea id="thesis" name="thesis" rows={2} className="field" />
            </div>
            <div>
              <label className="label" htmlFor="catalyst">Expected catalyst</label>
              <textarea id="catalyst" name="catalyst" rows={2} className="field" />
            </div>
            <div>
              <label className="label" htmlFor="risk">What could go wrong</label>
              <textarea id="risk" name="risk" rows={2} className="field" />
            </div>
            <div>
              <label className="label" htmlFor="holdingPeriod">Intended holding period</label>
              <input id="holdingPeriod" name="holdingPeriod" className="field" placeholder="e.g. 5+ years" />
            </div>
            <div>
              <label className="label" htmlFor="outcome">Outcome (fill in later)</label>
              <input id="outcome" name="outcome" className="field" />
            </div>
            <div>
              <label className="label" htmlFor="lessons">Lessons learned</label>
              <input id="lessons" name="lessons" className="field" />
            </div>
          </div>
          <label className="flex items-start gap-2 text-sm text-ink">
            <input type="checkbox" name="apply" defaultChecked className="mt-1" />
            <span>Update my holding with this buy or sell (quantity and average cost). Untick to record it in the journal only.</span>
          </label>
        </ActionForm>
      </Section>

      <Section title="Trade log">
        <div className="mb-5 grid grid-cols-3 gap-6">
          <Stat label="Realized gain" value={<Delta value={totals.realized} cents />} sub="Sells with a known cost" />
          <Stat label="Dividends" value={usd(totals.dividends, true)} />
          <Stat label="Fees paid" value={usd(totals.fees, true)} />
        </div>
        {trades.length === 0 ? (
          <Empty title="No trades logged yet">Trades you add appear here with your reasoning beside them.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {trades.map((t) => (
              <li key={t.id} className="py-3 first:pt-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-ink">
                    <span className="num text-muted">{shortDate(t.tradeDate)}</span> <Badge tone={t.type === 'buy' ? 'gold' : 'neutral'}>{t.type}</Badge> <span className="num font-medium">{t.symbol}</span>{' '}
                    <span className="num text-muted">
                      {t.type === 'dividend' || t.type === 'fee' ? usd(t.price * (t.quantity || 1), true) : `${qty(t.quantity)} @ ${price(t.price)}`}
                      {t.fees > 0 && ` · fees ${usd(t.fees, true)}`}
                    </span>
                    {t.realizedGain != null && (
                      <span className="ml-2 text-xs">
                        realized <Delta value={t.realizedGain} cents />
                      </span>
                    )}
                  </p>
                  <ActionButton action={deleteTradeAction} hidden={{ id: t.id }} label="Remove" variant="ghost" confirm="Remove this journal entry? Your holdings are not changed." />
                </div>
                {[['Thesis', t.thesis], ['Catalyst', t.catalyst], ['Risk', t.risk], ['Holding period', t.holdingPeriod], ['Outcome', t.outcome], ['Lessons', t.lessons]]
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <p key={k} className="mt-1 text-sm text-muted">
                      <span className="text-faint">{k}:</span> {v}
                    </p>
                  ))}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-xs text-faint">Pattern reviews across your journal (position sizing, chasing, early selling) are a planned AI module and are not generated yet.</p>
      </Section>
    </div>
  )
}

async function Watch({ db, userId, owned }: { db: Db; userId: string; owned: Set<string> }) {
  const list = await listWatchlist(db, userId)
  const quotes = await loadQuotes(db, list.map((w) => w.symbol))
  return (
    <div className="space-y-6">
      <Section title="Watchlist" hint="Things you are following but do not own. Kept separate from your holdings and never counted in any total.">
        {list.length === 0 ? (
          <Empty title="Nothing on your watchlist" />
        ) : (
          <ul className="divide-y divide-line">
            {list.map((w) => {
              const q = quotes.get(w.symbol)
              const hit = q && w.targetPrice != null && q.price <= w.targetPrice
              return (
                <li key={w.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0">
                  <div className="min-w-0">
                    <p className="text-sm">
                      <span className="num font-medium text-ink">{w.symbol}</span> <span className="text-muted">{w.name}</span> {owned.has(w.symbol) && <Badge tone="gold">Also owned</Badge>}
                    </p>
                    {w.thesis && <p className="mt-1 text-sm text-muted">{w.thesis}</p>}
                  </div>
                  <div className="flex items-center gap-4 text-right">
                    <div>
                      <p className="num text-sm text-ink">{q ? price(q.price) : 'No price'}</p>
                      {q && <p className="text-[11px] text-faint">{freshness(q.quoteTime, q.fetchedAt).label}</p>}
                      {w.targetPrice != null && (
                        <p className="num text-xs text-muted">
                          watching for {price(w.targetPrice)} {hit && <Badge tone="warn">At or below</Badge>}
                        </p>
                      )}
                    </div>
                    <ActionButton action={deleteWatchAction} hidden={{ id: w.id }} label="Remove" variant="ghost" />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        <p className="mt-4 text-xs text-faint">Reaching a watched price is only a prompt to look again. A lower price alone does not mean something is undervalued.</p>
      </Section>
      <Section title="Add to watchlist">
        <ActionForm action={addWatchAction} submitLabel="Add">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="w-symbol">Symbol</label>
              <input id="w-symbol" name="symbol" className="field num uppercase" required maxLength={12} />
            </div>
            <div>
              <label className="label" htmlFor="w-name">Name</label>
              <input id="w-name" name="name" className="field" />
            </div>
            <div>
              <label className="label" htmlFor="w-target">Price to watch for</label>
              <input id="w-target" name="targetPrice" className="field num" inputMode="decimal" />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="w-thesis">Why it interests me</label>
            <textarea id="w-thesis" name="thesis" rows={2} className="field" />
          </div>
        </ActionForm>
      </Section>
    </div>
  )
}

async function Notes({ db, userId, today }: { db: Db; userId: string; today: string }) {
  const list = await listNotes(db, userId)
  return (
    <div className="space-y-6">
      <Section title="Add a note or review">
        <ActionForm action={addNoteAction} submitLabel="Save note">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="noteDate">Date</label>
              <input id="noteDate" name="noteDate" type="date" className="field num" defaultValue={today} />
            </div>
            <div>
              <label className="label" htmlFor="n-symbol">Symbol (optional)</label>
              <input id="n-symbol" name="symbol" className="field num uppercase" maxLength={12} />
            </div>
            <div>
              <label className="label" htmlFor="kind">Kind</label>
              <select id="kind" name="kind" className="field">
                <option value="note">Note</option>
                <option value="review">Dated review of a holding</option>
              </select>
            </div>
          </div>
          <textarea name="body" rows={4} className="field" aria-label="Note" required />
        </ActionForm>
      </Section>
      <Section title="My notes">
        {list.length === 0 ? (
          <Empty title="No notes yet" />
        ) : (
          <ul className="divide-y divide-line">
            {list.map((n) => (
              <li key={n.id} className="py-3 first:pt-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted">
                    <span className="num">{shortDate(n.noteDate)}</span> {n.symbol && <span className="num font-medium text-gold">{n.symbol}</span>} {n.kind === 'review' && <Badge>Review</Badge>}
                  </p>
                  <ActionButton action={deleteNoteAction} hidden={{ id: n.id }} label="Remove" variant="ghost" confirm="Remove this note?" />
                </div>
                <p className="mt-1 text-sm whitespace-pre-wrap text-ink">{n.body}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}
