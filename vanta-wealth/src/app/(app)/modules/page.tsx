import type { Metadata } from 'next'
import { Badge, Card, PageHeader } from '@/components/ui'

export const metadata: Metadata = { title: 'Coming Next' }

const PHASES = [
  {
    phase: 'Phase 2 · Intelligence',
    items: [
      ['Risk', 'Correlation between holdings, look-through to what your funds hold, sector and country exposure, and stress tests against 2008, 2020 and 2022.', 'Needs daily price history; a free source is being evaluated.'],
      ['Stock Research', 'Per-holding pages with price charts, moving averages, RSI, MACD, and fundamentals from company filings.', 'Fundamentals from SEC filings are free; analyst estimates need licensed data and will stay blank without it.'],
      ['AI Wealth Advisor and daily briefing', 'Ask questions about your own portfolio in plain language, with a “why it matters” line on news.', 'Needs an AI key; usage-based cost, estimated at $5–20 a month.'],
      ['Crypto center', 'Position tracking in more depth, drawdown history, and how crypto moves with your stocks.', 'Price data is free; fund-flow and on-chain data mostly are not.'],
      ['Macro & tax', 'Yield curve, inflation, unemployment and market valuation, plus short- and long-term gain tracking.', 'Free government data key.'],
      ['Alerts', 'Notices when a holding moves past your threshold, a rule breaks, or earnings approach, with quiet hours and no repeats.', 'In-app first; email later.'],
    ],
  },
  {
    phase: 'Phase 3 · Advanced investing',
    items: [
      ['Opportunity Scanner', 'Screens for growth, value, quality, income and turnaround candidates, with objective conditions shown before any interpretation.', 'Needs fundamentals for many companies.'],
      ['Options Center', 'Option chains, Greeks, breakeven and maximum loss, a paper-trading simulator, and a coach that classifies setups.', 'No dependable free option-chain source; expect roughly $30 or more a month.'],
      ['Congressional trades', 'Publicly disclosed trades by legislators, with filing delays shown clearly.', 'Public filings exist, but no dependable free feed.'],
      ['Read-only account linking', 'Automatic import from brokerages and exchanges that officially support it.', 'Depends on each provider; never by sharing a password.'],
    ],
  },
  {
    phase: 'Phase 4 · Asset Builder',
    items: [
      ['Capital allocation strategist', 'Compare defensive, balanced, growth and aggressive ways to place your next contribution.', ''],
      ['Rental property analyzer', 'Duplex and small multifamily modelling: mortgage, expenses, vacancy, cash flow, cash-on-cash return and debt coverage.', ''],
      ['Income asset planner', 'Dividend, bond, rental and business income compared on capital required, income, costs, risk and liquidity.', ''],
      ['Invest or convert scenarios', 'Leaving money invested against using some toward a property, including taxes and emergency liquidity.', ''],
      ['Long-range outlook and geopolitical watch', 'Researched theme cards and conflict scenarios with sources and clearly labelled estimates.', 'Weekly AI research; the least certain material, so built last.'],
    ],
  },
] as const

export default function ModulesPage() {
  return (
    <>
      <PageHeader title="Coming Next" subtitle="Modules that are planned but not built. They are listed here rather than shown as empty screens, and none of them displays placeholder numbers." />
      <div className="space-y-8">
        {PHASES.map((p) => (
          <section key={p.phase}>
            <h2 className="eyebrow mb-3 !text-gold">{p.phase}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {p.items.map(([title, body, note]) => (
                <Card key={title} className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-display text-lg text-ink">{title}</h3>
                    <Badge>Planned</Badge>
                  </div>
                  <p className="mt-2 text-sm text-muted">{body}</p>
                  {note && <p className="mt-2 text-xs text-faint">{note}</p>}
                </Card>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  )
}
