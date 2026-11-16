import type { Metadata } from 'next'
import { refreshNewsAction } from '../../actions'
import { loadFeeds, loadNews, refreshNews } from '@/lib/data/store'
import { dateTime, shortDate } from '@/lib/format'
import { config } from '@/lib/server/config'
import { isoDay } from '@/lib/time'
import { loadPage } from '@/lib/server/load'
import { tagHeadline } from '@/lib/view/briefing'
import { ActionButton } from '@/components/forms'
import { Badge, Empty, LinkButton, Notice, PageHeader, Section } from '@/components/ui'

export const metadata: Metadata = { title: 'Market Watch' }

const HOUR: Record<string, string> = { bmo: 'before the market opens', amc: 'after the market closes', dmh: 'during market hours' }

export default async function NewsPage({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  const { db, overview: o } = await loadPage()
  const key = config.finnhubKey()
  const symbols = o.holdings.filter((h) => h.assetClass !== 'crypto').map((h) => h.symbol)
  const { s: only } = await searchParams
  const result = await refreshNews(db, symbols, key).catch(() => ({ errors: ['The news source could not be reached.'], ran: true }))
  const [{ news, earnings }, feeds] = await Promise.all([loadNews(db, symbols), loadFeeds(db)])
  const fetched = feeds.get('news')
  const shown = only && symbols.includes(only) ? news.filter((n) => n.symbol === only) : news
  const week = isoDay(7)

  return (
    <>
      <PageHeader title="Market Watch" subtitle="News and scheduled events for the holdings you own, and nothing else." actions={key && symbols.length ? <ActionButton action={refreshNewsAction} label="Check for news" pendingLabel="Checking…" /> : undefined} />
      <div className="space-y-6">
        {!symbols.length ? (
          <Empty title="No stock or fund holdings yet">News is shown only for what you own.</Empty>
        ) : !key ? (
          <Notice tone="warn">
            News needs the free Finnhub key. <a href="/settings#data" className="underline">See the setup steps in Settings.</a> No headlines are shown until a real source is connected.
          </Notice>
        ) : (
          <>
            {(result.errors.length > 0 || fetched?.error) && <Notice tone="warn">News source problem: {result.errors[0] ?? fetched?.error} Showing what was received earlier.</Notice>}
            <Section title="Upcoming events" hint="Earnings dates reported by Finnhub for the next 45 days. Dates can change; confirm on the company's investor page.">
              {earnings.length === 0 ? (
                <p className="text-sm text-muted">Nothing scheduled for your holdings in the next 45 days.</p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {earnings.map((e) => (
                    <li key={e.id} className="rounded-xl border border-line px-3 py-2">
                      <p className="num text-sm font-medium text-ink">
                        {e.symbol} {e.day <= week && <Badge tone="warn">This week</Badge>}
                      </p>
                      <p className="text-xs text-muted">
                        Earnings · {shortDate(e.day)}
                        {HOUR[e.hour] ? `, ${HOUR[e.hour]}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Holdings news" hint={`Latest headlines from the past week${fetched ? `, checked ${dateTime(fetched.fetchedAt)}` : ''}. Source: Finnhub company news. Tags come from headline keywords and are not a judgement of importance.`}>
              <div className="mb-4 flex flex-wrap gap-1.5">
                <LinkButton href="/news" size="sm" variant={!only ? 'primary' : 'secondary'}>
                  All
                </LinkButton>
                {symbols.map((sym) => (
                  <LinkButton key={sym} href={`/news?s=${sym}`} size="sm" variant={only === sym ? 'primary' : 'secondary'} className="num">
                    {sym}
                  </LinkButton>
                ))}
              </div>
              {shown.length === 0 ? (
                <p className="text-sm text-muted">No headlines in the past week. Nothing important is a valid result.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {shown.slice(0, 60).map((n) => (
                    <li key={n.id} className="py-3 first:pt-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                        <span className="num font-medium text-gold">{n.symbol}</span>
                        <Badge>{tagHeadline(n.headline)}</Badge>
                        <span>
                          {n.source} · {dateTime(n.publishedAt)}
                        </span>
                      </div>
                      <a href={n.url} target="_blank" rel="noopener noreferrer" className="mt-1 block text-sm font-medium text-ink underline-offset-2 hover:underline">
                        {n.headline}
                      </a>
                      {n.summary && n.summary !== n.headline && <p className="mt-1 line-clamp-2 text-sm text-muted">{n.summary}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </>
        )}
        <Notice>
          Not connected yet: a written “why it matters” line and impact rating per story, Federal Reserve and economic-report calendars, SEC filing alerts, and congressional trade disclosures. They are listed under Coming Next and stay blank until a real source is connected.
        </Notice>
      </div>
    </>
  )
}
