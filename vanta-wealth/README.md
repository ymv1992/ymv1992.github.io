# Vanta Wealth

A private investment command center: what you own, how it is performing, how it
compares with your own targets and rules, and where it could go under
assumptions you control.

It is a decision-support and education tool. It shows data, calculations and
flags. It does not give buy or sell instructions, never places trades, and is
not a substitute for a licensed financial, tax or legal adviser.

**No personal financial data lives in this repository.** The repository is
public; everything you enter is stored only in your private database.

## What works today (Phase 1)

| Page | What it does |
|---|---|
| Command Center | Portfolio value, net worth, liquid assets, gain/loss, a rule-based briefing, progress to $1M and $5M, mix against targets, recorded value over time |
| My Portfolio | Holdings with price, value, cost basis, gain/loss and share of portfolio; Confirmed and Unverified sections; other accounts (retirement, cash, property, business); paste/CSV import with a preview and confirmation step |
| Diversification | Current mix against an editable target mix, your rules flagged when broken, a step-by-step plan, a "top 3" dilution calculator, wash-sale check |
| Market Watch | News and upcoming earnings for holdings you own, with source and timestamp |
| Millionaire Roadmap | Monte Carlo projection (5,000 paths), chance of reaching a goal, milestones, what-if scenarios, fee drag, financial-freedom number |
| Trade Journal | Trade log with thesis and lessons, per-holding theses, watchlist, notes |
| Settings | Profile, data-connection status with setup steps, data export, delete, activity log |

Planned modules are listed on the Coming Next page. They are not shown as
empty screens and never display placeholder numbers.

## Rules the app follows

- Prices are stored exactly as the provider returned them, with the provider's
  timestamp. A holding without a price is shown at cost and labelled, or left
  out and labelled. Nothing is estimated.
- A self-reported portfolio total is shown for comparison only and is never
  added to tracked holdings.
- Property and business equity count toward net worth only, never toward
  liquid assets or the investable portfolio.
- An import never overwrites saved holdings unless you tick the box to replace
  them, after seeing the differences.
- No risk profile is assumed. You choose one.
- Projections are models built on your assumptions and say so.

## Setting it up (about 20 minutes, no command line)

This app uses the same hosting pattern as Points & Paradise: Vercel for the
site, Supabase for the database. Both have free plans.

1. **Database.** You can reuse the Supabase project you already have. This app
   keeps its tables in a separate `vanta` schema, so the two apps do not
   collide. In Supabase, open Project Settings → Database → Connection string,
   choose **Transaction pooler** (port 6543), and copy it.
2. **Create the site.** In Vercel choose Add New → Project and import this
   GitHub repository again. Set **Root Directory** to `vanta-wealth`.
3. **Add environment variables** (Vercel → Settings → Environment Variables):
   - `DATABASE_URL` — the connection string from step 1
   - `OWNER_EMAIL` — the email you will sign in with
   - `CRON_SECRET` — any long random text (enables the daily value recording)
4. **Deploy**, then open the site. The sign-in page shows a first-time setup
   box: choose a passphrase and it gives you two values. Add them in Vercel as
   `OWNER_PASSWORD_HASH` and `SESSION_SECRET`, then redeploy.
5. **Sign in** and import your holdings on the My Portfolio page.
6. **Connect prices.** Settings → Data connections walks through getting the
   free Finnhub key (`FINNHUB_API_KEY`). Crypto prices need no key.

## Data sources and cost

| Need | Source | Cost | Status |
|---|---|---|---|
| Stock/ETF quotes, company news, earnings dates | Finnhub free plan | $0 | Built |
| Crypto prices | CoinGecko public API | $0 | Built |
| Hosting and database | Vercel Hobby, Supabase Free | $0 | Built |
| Daily price history, risk statistics | To be chosen | $0 expected | Phase 2 |
| Fundamentals | SEC EDGAR | $0 | Phase 2 |
| AI briefing and advisor | Claude API | usage-based, est. $5–20/mo | Phase 2 |
| Option chains with Greeks | Paid provider | est. $30+/mo | Phase 3 |
| Congressional trades | No dependable free feed | unknown | Phase 3 |
| Brokerage sync | Only where officially supported | varies | Phase 3 |

Provider limits and terms change; confirm them before enabling a paid service.
Phase 1 runs at $0 a month.

## Known limits

- **History starts when you start.** Portfolio value is recorded daily from
  first use. Time-weighted return, benchmark comparison, volatility and
  drawdown need dated transactions and price history, and are not shown yet.
- **Holding periods need purchase dates.** Without them the app says the
  long-term or short-term status is unknown.
- **News tags are keyword matches**, not a judgement of importance.
- **Projections omit taxes** and use a simple return model.
- The data providers were exercised with stand-in responses during
  development; the first run with a real key is the first live test.

## Architecture

- Next.js (App Router) + TypeScript + Tailwind CSS
- Postgres via Drizzle ORM, in a dedicated `vanta` schema with row-level
  security enabled on every table; embedded PGlite for local development
- Single-owner sign-in: scrypt password hash, signed HTTP-only session cookie,
  login rate limiting; no public registration
- API keys are read on the server only and never reach the browser
- `src/lib/engine` holds the pure calculation code (valuation, allocation,
  rules, projections, import parsing); `tests/` covers it

### Tables (`vanta` schema)

`users`, `auth_attempts`, `profiles` (targets, rules, assumptions),
`holdings`, `manual_assets`, `watchlist`, `trades`, `notes`, `quotes`,
`snapshots`, `news_items`, `earnings_events`, `feed_state`, `audit_log`.

## Development

```bash
npm install
npm run dev
```

```bash
npm run check
```
