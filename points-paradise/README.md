# Points & Paradise

A private, mobile-first web app that finds, values, ranks and tracks Chase
Ultimate Rewards travel redemptions for one owner.

It calculates cents per point (CPP), transfer math, deadlines and positioning
costs with deterministic code. It shows where every number came from and how
old it is. When it can't calculate a value, it says so instead of guessing.

It **never** books travel, transfers points, takes payments, stores loyalty or
Chase passwords, stores card numbers, scrapes websites, or makes up prices,
availability or booking links. Demo data is fictional and is labelled
**DEMO** everywhere it appears.

- Architecture, costs, schema, page map, phases and risks:
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- What works today and what doesn't: see
  [Implemented vs incomplete](#implemented-vs-incomplete) below.

---

## Quick start (local)

Requirements: Node.js 20.9 or newer (22 recommended). Docker and a Postgres
server are not needed. Local development uses PGlite, an embedded Postgres
stored in `.data/pglite`.

```bash
cd points-paradise
npm install
cp .env.example .env.local

# 1. Create your password hash. Use a long passphrase of at least 12 characters.
npm run hash-password -- 'correct horse battery staple paradise'
#    Paste the output into OWNER_PASSWORD_HASH and set OWNER_EMAIL in .env.local.

# 2. Create a session secret, then paste it into SESSION_SECRET.
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"

# 3. Run the app.
npm run dev
```

Open http://localhost:3000 and sign in. Onboarding asks for your:

- card
- points balance (default 150,000)
- home airports (default SAN, LAX, SNA, ONT, BUR)
- cash budget (default $1,000)
- travel style
- flexibility
- deal types

The schema is migrated and reference data (transfer partners and data
sources) is seeded automatically the first time the app opens the database.

### Demo data

To try the app before you have real deals, use either of these:

- **Settings → Data sources →** tick **Show demo data**, then **Apply demo setting**, or
- `npm run db:seed -- --demo`

Either one adds 32 fictional deals. Among them is the Tokyo example: $5,200
cash, 75,000 miles, an illustrative 25% bonus, 60,000 Chase points, $180
taxes, about 8.37¢ per point.

Demo deals:

- are labelled "Demo only — not live"
- are never ranked as bookable
- never trigger alerts
- are removed when you turn the setting off

## Environment variables

Copy `.env.example` and fill in what you need. Every provider is optional.
The app keeps working without it and shows what is not configured.

| Variable | Required | Purpose |
|---|---|---|
| `OWNER_EMAIL` | yes | The only email that can sign in. |
| `OWNER_PASSWORD_HASH` | yes | Output of `npm run hash-password`. It is a scrypt hash, so the password itself is never stored. |
| `SESSION_SECRET` | yes in production | 32+ random characters. Used to sign the session cookie. |
| `APP_URL` | production | Public URL, used in email links. |
| `DATABASE_URL` | production | Postgres connection string (Supabase pooler). If unset, PGlite is used locally. |
| `DATABASE_POOL_MAX` | no | Postgres pool size (default 3). |
| `PGLITE_DIR` | no | Where local PGlite data lives (default `.data/pglite`). |
| `ALLOW_PGLITE` | no | Set to `true` only to run a production build on PGlite (for example a local `next start`). |
| `CRON_SECRET` | for scheduled jobs | Bearer token required by `/api/cron/*`. |
| `SEATS_AERO_API_KEY` | no | seats.aero Pro key for cached award availability. |
| `SERPAPI_API_KEY` | no | SerpApi key for comparable cash fares and hotel rates. |
| `RESEND_API_KEY`, `EMAIL_FROM` | no | Email alerts and the daily digest. |
| `ANTHROPIC_API_KEY` | no | AI-written explanations, destination ideas and trip narratives. AI is used for prose only. |
| `ANTHROPIC_MODEL` | no | Overrides the default low-cost model. |
| `UNSPLASH_ACCESS_KEY` | no | Destination photos, credited to the photographer. |
| `RSS_FEEDS` | no | Comma- or space-separated `https://` feed URLs to watch for transfer-bonus and deal announcements. |

Secrets are read only in server code (`src/lib/server/config.ts`, which
imports `server-only`). Pages receive yes/no flags, never keys.

## Database and migrations

| Command | What it does |
|---|---|
| `npm run db:migrate` | Applies `drizzle/*.sql` to `DATABASE_URL`, or to local PGlite if that is unset. |
| `npm run db:seed` | Ensures reference data exists. Add `-- --demo` to also insert demo deals. Safe to repeat. |
| `npm run db:generate` | Generates a new migration after you change `src/lib/db/schema.ts`. |

Migration `0001_security_and_checks.sql` turns on row-level security for
every table, with no policies. This means Supabase's public API keys can't
read or write anything. The app connects as the database owner, which
bypasses RLS. The same migration adds check constraints for points, cash,
dates and ratios.

## Deploying (Vercel + Supabase, free tiers)

### 1. Create the database (Supabase)

1. Create a free project at supabase.com.
2. Open **Connect** and copy the **Transaction pooler** connection string (port 6543).
3. Use that string as `DATABASE_URL`. The app already sets `prepare: false`,
   which the pooler needs.
4. Free projects pause after about a week with no activity. The daily job
   normally counts as activity. If the project does pause, resume it from the
   Supabase dashboard; no data is lost.

### 2. Deploy the app (Vercel)

1. Import this GitHub repository into Vercel.
2. Set **Root Directory** to `points-paradise`.
3. `vercel.json` already sets the build command to
   `npm run db:migrate && npm run build`, so migrations run on every deploy.
4. Add the environment variables from the table above for Production:
   - at minimum `OWNER_EMAIL`, `OWNER_PASSWORD_HASH`, `SESSION_SECRET`,
     `DATABASE_URL`, `APP_URL` and `CRON_SECRET`
   - any provider keys you want to use
5. Deploy, open the site, and sign in.

If a migration fails through the pooler, run it once from your computer
against the session pooler or direct connection string:

```bash
DATABASE_URL='postgres://…' npm run db:migrate
```

### 3. Scheduled jobs

There are three jobs, all at `/api/cron/<job>`:

| Job | What it does |
|---|---|
| `discover` | Automatic discovery: the next batch of seats.aero searches from your home airports (see [Automatic discovery](#automatic-discovery)). |
| `frequent` | Deadline reminders, due watch checks and a small discovery batch. |
| `daily` | Watch checks, deadline reminders, archiving expired deals, recomputing values, comparable-cash enrichment, photos, RSS ingest, alerts and the daily digest. |

All jobs require the header `Authorization: Bearer $CRON_SECRET`.

- **Vercel Cron.** `vercel.json` runs `discover` at 13:05 UTC and `daily`
  at 14:17 UTC (6:05 and 7:17 AM Pacific in summer), so the morning alerts
  see the newest finds. Vercel adds the bearer header automatically when
  `CRON_SECRET` is set. The Hobby plan runs each job once a day.
- **GitHub Actions (optional, also free).** `.github/workflows/points-paradise-cron.yml`
  runs `frequent` every hour and `daily` once a day. To turn it on:
  1. Add the repository **variable** `PP_CRON_ENABLED=true`.
  2. Add the repository **secrets** `PP_APP_URL` (for example
     `https://your-app.vercel.app`) and `PP_CRON_SECRET` (the same value as
     `CRON_SECRET`).
- **Run on demand.** **Alerts → Run checks now** runs the same checks for
  you immediately.

To call a job by hand:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://your-app.vercel.app/api/cron/daily
```

### Automatic discovery

With `SEATS_AERO_API_KEY` set, the `discover` job searches seats.aero's
cached award availability from your home airports to:

- 58 popular award destinations in 10 regions: Japan and Korea, Southeast
  Asia, Hawaii and the South Pacific, Australia and New Zealand, Europe, the
  Middle East and Africa, Mexico and Costa Rica, and South America
- up to 6 dream destinations from your profile that match an airport code
  or exact city name

Each search covers the cabins you pick in **Settings → Data sources →
Automatic discovery** (business and first by default). It looks about 11
months ahead, in three windows. For each destination city, cabin and month
it keeps the cheapest date and refreshes dates it already showed. Seats that
disappear move to **History** as "Award space disappeared".

Cost stays at the seats.aero subscription:

- Discovery uses at most 100 of the 1,000 daily calls included in Pro.
- It always leaves 200 calls for watches and Award Calendar searches.
- It stops at the daily limit instead of going over it.

Calls are logged at **Settings → Usage** as `discovery`.

A full cycle takes a few days with only the daily Vercel job. Enabling the
optional hourly GitHub Actions job, or tapping **Alerts → Run checks now**,
speeds it up.

**Hotels.** The same key works for rooms.aero, seats.aero's hotel search, which
has its own 1,000 daily calls. The `discover` job (and **Run checks now**)
also searches 37 popular places plus your dream destinations for award nights
at Hyatt, Marriott, IHG and Wyndham. Stays are the length of your shortest
trip in your profile, kept between 1 and 5 nights.

- It keeps the six best-value hotels per place.
- rooms.aero gives the hotel's cash rate for the same stay, so hotel finds
  get a cents-per-point value straight away and can appear in Top 100.
- A hotel that stops appearing for 10 days moves to History.
- Hotel discovery uses at most 60 calls a day. Switch it off in **Settings →
  Data sources → Automatic discovery**.
- The rooms.aero client follows public example code, because the official
  reference wasn't reachable when it was written. Every search records what
  came back at **Settings → Usage**.

Discovered flights don't have a cash price at first. Discover lists them by
fewest points until a comparable cash price is added. There are three ways
to add one:

- Tap **Get cash price** on a flight in the Award Calendar results or on its
  deal page. This uses one SerpApi search.
- Let SerpApi add up to five a run on its own. It prices saved deals first,
  then first and business class, and waits 7 days before retrying a flight
  it couldn't match.
- Type in the cash price yourself.

SerpApi's free plan has 250 searches a month, and the app stops at 200.
Once a flight has a cash price, it shows a cents-per-point value and can
appear in Top 100. Later seats.aero refreshes don't remove the cash price. seats.aero covers only some Chase
partners (United, Air Canada Aeroplan, Air France/KLM Flying Blue and Virgin
Atlantic in this app), and hotel awards come from rooms.aero (see Hotels above).

### GitHub Pages note

This repository also hosts a GitHub Pages site. The root `_config.yml`
excludes `points-paradise/` from the Jekyll build, so the app's source and
docs are not published as Pages content. The app itself runs on Vercel.

## Enabling providers

Every provider is off until its key is set. Each one is cached,
quota-limited and logged at **Settings → Usage**. Paid calls pause before
your monthly cap is reached (defaults: $5 for APIs, $2 for AI, both editable
in Settings). Read each provider's terms before enabling it. The
restrictions are summarized at **Settings → Data sources** and in
`docs/ARCHITECTURE.md`.

| Provider | How to enable | What you get |
|---|---|---|
| **seats.aero** | Subscribe to Pro ($9.99/month or $99.99/year in the US, as reported in October 2026) and create an API key. Set `SEATS_AERO_API_KEY`. | Automatic discovery for Discover and Top 100, cached award availability on your route watches, and award search on the Award Calendar. API calls are included in Pro (1,000 per day). Personal, non-commercial use only. |
| **SerpApi** | Create an account and set `SERPAPI_API_KEY`. | Comparable cash fares (Google Flights) and hotel rates (Google Hotels), used to value deals that have no cash price yet. Free plan: 250 searches a month; the app uses at most 200. |
| **Resend** | Verify a sending domain or address. Set `RESEND_API_KEY` and `EMAIL_FROM`, then turn on email in Settings. | Instant alerts and the daily digest by email. |
| **Anthropic** | Create an API key and set `ANTHROPIC_API_KEY`. | AI-written deal explanations, destination ideas and trip narratives. The AI receives computed facts only and never generates prices or availability. |
| **Unsplash** | Register an app and set `UNSPLASH_ACCESS_KEY`. | Destination photos with credit to the photographer. Without a key, the app draws its own illustrations. |
| **RSS** | Set `RSS_FEEDS`. | Matching announcements appear in **Alerts** as unverified leads for you to review. |

Chase has no public API. You enter these yourself; the app gives
step-by-step instructions:

- Chase balances
- card type
- Chase Travel portal prices
- confirmed transfer bonuses

## Testing

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest: 119 tests
npm run check       # all three
SESSION_SECRET=any-32-character-placeholder-value npm run build
```

### Test coverage

| Test file | What it covers |
|---|---|
| `tests/engine/*` | CPP and practical value, comparability refusals, transfer math (ratios, card overrides, bonuses, increments, minimums, rounding), ranking and evidence tiers, deadlines and reminders (including DST), staleness, personalization, positioning, budgets, priority queue, alert decisions, trip building, trip-request parsing. |
| `tests/db/*` | Award search (Anywhere and single route, partial failures, quota, validation). Runs against in-memory PGlite. Reference seeds, account bootstrap, manual-deal validation and dedupe, price history, archiving, saved snapshots, collection ownership, undo, notification dedupe, demo labelling and removal. |
| `tests/jobs/*` | Reminders sent once, seats.aero watch checks, quota exhaustion, a missing key reported rather than crashing, RSS ingest, automatic discovery (search parameters, cheapest-date selection, vanished seats moved to History, daily cap and quota reserve, on/off switch, one dream alert per city). |
| `tests/providers/*` | Adapters run against recorded response fixtures. |

Database and job tests use in-memory PGlite by default. To run them against a
real Postgres server through the same driver production uses, point
`TEST_DATABASE_URL` at a server where you can create databases (each test
file gets its own new database). CI does this on every change:

```bash
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres npx vitest run tests/db tests/jobs
```

`tests/fixtures.ts` holds the test fixtures. They are separate from the
demo seed and from production data.

GitHub Actions runs typecheck, lint, tests and build on every push that
touches `points-paradise/` (`.github/workflows/points-paradise-ci.yml`).

## Your data

- **Settings → Privacy & data → Download my data (JSON)** exports everything.
- **Settings → Privacy & data → Permanently delete my data** removes your
  account data. Transfer-partner reference data is kept.
- No loyalty passwords or card numbers are ever requested or stored.

## Implemented vs incomplete

### Implemented and tested

- **Sign-in and onboarding.** Owner-only sign-in, rate-limited, with a
  signed session cookie. First-run onboarding, a points wallet with card
  type, and multiple travel profiles.
- **Discover.** Swipe and list modes with Save, Pass, Details and Undo, and
  ten feed modes.
- **Rankings.** Top 100 and 13 category leaderboards with filters and
  sorts. Every rank explains itself. Unverified, stale, expired and demo
  deals are never ranked as bookable.
- **Value engine.** Headline and practical CPP. It flags inflated cash
  prices and shows "Value cannot be reliably calculated" when cash and award
  products don't match.
- **Transfer Center.** Partner directory with card-specific ratios
  (including the reported Hyatt 4:3 change for some cards) and promotions
  with time-zone-aware windows. The calculator rates whether a transfer is
  advisable and warns against speculative transfers. You can edit partners.
- **Deal detail.** Value breakdown, transfer plan, booking checklist,
  aircraft and room verification checklist, countdown for confirmed
  deadlines only, and price history.
- **Deal entry.** Manual entry and JSON/CSV import, both validated, with
  dedupe.
- **Saved.** Nine default collections plus your own, notes, ratings,
  save-time snapshots compared with current values, side-by-side compare,
  and watches.
- **Alerts.** Alert preferences, dedupe, quiet hours, the daily digest, and
  reminders at 7 days, 3 days, 24 hours, 6 hours and 1 hour. Delivered in
  the app, by browser notification while the app is open, and by email.
- **Automatic discovery.** With a seats.aero key, a daily search from your
  home airports to 58 popular destinations plus your dream destinations
  fills Discover and Top 100 on its own, along with award nights at Hyatt,
  Marriott, IHG and Wyndham hotels in 37 popular places through rooms.aero
  (same key). It can be switched off, limited to certain cabins, or set to
  skip hotels in Settings.
- **History.** Archive of missed and expired deals, with "watch for similar".
- **Award search, including "Anywhere".** On the Award Calendar page (or
  **Discover → Search anywhere**), leave "To" empty to check all discovery
  destinations from an airport, optionally with your other home airports,
  for chosen dates and cabin. You get the cheapest date per city and month,
  listed cheapest first. That's about 10 seats.aero lookups per search, so
  no extra cost. Each result shows its Chase points and a **Get cash price**
  button that adds its value (¢/pt). Optional filters narrow results to one
  **airline** (who flies you, including connections that use it) and one
  **program** to book with (United MileagePlus, Aeroplan, Flying Blue or
  Virgin Atlantic Flying Club). Results show airline names and which
  program's miles the price is in. Filtering happens after the search, so it
  uses no extra lookups.
- **Hotel search.** The Award Calendar's **Hotels** tab searches one place
  (such as "Maui, Hawaii") through rooms.aero. You choose check-in dates,
  1–5 nights and the programs (Hyatt, Marriott, IHG, Wyndham). Each search
  is one lookup. Results show Chase points, the hotel's cash rate and the
  value, best value first.
- **Award Calendar.** Heatmap, price-history chart, seasonal table and
  predictions marked with their evidence tier. Predictions are withheld when
  there is too little data.
- **My Trips (itinerary builder).** Under **Plan → My Trips**:
  - **Trips.** A trip has dates, or is a "someday" trip with just a number
    of days.
  - **Days and ideas.** Each day lists its plans: activities, food, flights,
    stays, getting around and notes. A time, place (with a Google Maps
    link), link, cost, Chase points and notes are all optional. An **Ideas**
    list holds things not yet on a day.
  - **Rearranging.** Grab the dotted handle to drag an item within a day,
    to another day or to Ideas. On a phone, press and hold. Editing an item
    and picking another day also moves it.
  - **Checking off.** Tick items off as you go. Totals show the trip's Chase
    points (against your balance) and cash.
  - **Adding deals.** Add a saved deal, or an award flight already found for
    the trip. It lands on its travel day when that's during the trip.
  - **Watch for deals.** Needs the airport you'd fly into. It creates one
    seats.aero route watch from your home airports, covering 3 days either
    side of the start date (or the coming year for a someday trip). It's
    removed with the trip.
  - **Share with a partner.** Turns on a read-only link (`/share/<token>`)
    that shows only that trip and isn't indexed by search engines. Stopping
    sharing turns the link off.
  - **Maps and photos.** Paste a Google link (Google Maps links, short
    `maps.app.goo.gl` links, and `share.google` / `g.co` links shared from
    Google Search or the Google app), or fill in a place, and the item shows a map
    with a pin and, for well-known places, a real photo. The place is read
    straight from the link, or found with OpenStreetMap's free place
    search near the trip's destination. Photos come from Wikipedia and
    Wikimedia Commons, freely licensed and shown with the photographer and
    licence. A photo is used only when the article's name matches the place
    and it is close to the pin, so most restaurants and shops get a map but
    no photo. Each place is looked up once and the result is kept for 90
    days. Daily caps keep usage light (300 OpenStreetMap searches, 1,500
    Wikimedia requests). **Find maps & photos** fills in items added before
    this existed, or that found nothing before. With no place and no
    readable link, the item's title is searched near the destination, and
    the name of what was found is shown as the place, so a wrong pin is easy
    to spot. Links the app can't read are listed in Settings → Usage. No
    keys, no cost.
  - **Local currency.** Pick a trip's local currency in its details, then
    enter costs in that currency (or any other on the list). Each shows its
    dollar value too, such as "¥12,000 · about $80", and totals are in
    dollars.
    - **Where rates come from.** The European Central Bank's daily reference
      rate, via Frankfurter. Currencies the ECB doesn't publish (such as
      the Costa Rican colón) use the community currency-api instead. Both
      are free, with no key.
    - **Locking.** A currency's rate is locked to the trip the first time
      it's needed, so totals don't drift. **Update to today's rate** replaces
      it.
    - **Your own rate.** You can type your own rate (for example, your
      card's). Currencies with no rate yet are listed apart from the
      dollar total.
    - **Existing trips.** Dollar costs entered before this keep working
      unchanged.
  - **Download PDF.** Downloads the itinerary with tick boxes, from your
    page or the share link. The PDF uses the standard built-in fonts, so
    letters outside Western European alphabets print as "?" and emoji are
    left out.
- **Positioning optimizer.** Full cost breakdown and separate-ticket
  warnings.
- **Trip Architect.** Turns a plain-English request into plans that fit
  your points and cash. Incomplete plans are labelled.
- **Personality engine.** Learns from your choices and can be reset.
  Personal match is kept separate from value.
- **Scheduling and limits.** Scheduled jobs, the usage dashboard, spend
  caps and the data-source registry.
- **App shell.** PWA install with an offline page, and light and dark
  themes.

### Built but not exercised against live services

This environment had no provider keys, so these paths are tested only with
recorded fixtures, mocks, or type-checking:

- **seats.aero, SerpApi, Unsplash and RSS adapters.** Tested with recorded
  response shapes, not live calls. Run one check after adding each key and
  look at **Settings → Usage**.
- **Resend email.** The delivery logic is tested with a mocked sender. No
  real email was sent.
- **Anthropic AI features.** Explanations, ideas and narratives are
  type-checked and budget-gated but were not called live. Every feature
  works with AI turned off.
- **Supabase/Postgres.** Migrations and queries were run on PGlite
  (Postgres-compatible), not on a hosted Supabase database.

### Not implemented

- **Background push notifications** (Web Push) while the app is closed.
  Browser notifications appear only while a tab is open; use email for
  everything else.
- **Automatic Chase data**: balances, Chase Travel portal prices and
  transfer bonuses. There is no permitted API, so these are entered
  manually.
- **Hotel award availability beyond Hyatt, Marriott, IHG and Wyndham.**
  rooms.aero covers these Chase partners; other hotels are entered manually
  or imported.
- **Automatic seat maps, aircraft swaps and room-type verification.** The
  app gives a checklist and fields to record what you confirmed.
- **A committed end-to-end browser test suite.** The UI was smoke-tested in
  a headless browser during development; there is no committed Playwright
  suite.
- **Multi-user accounts** (Phase 5). Not built, by design.

## Project layout

```
points-paradise/
  src/app/            pages, server actions, API routes (cron, export)
  src/components/     UI components (cards, charts, map, forms)
  src/lib/engine/     pure, tested calculation engine
  src/lib/data/       database queries and business operations
  src/lib/providers/  external API adapters (server-only)
  src/lib/db/         schema, client, reference and demo seeds
  drizzle/            SQL migrations
  scripts/            migrate, seed, hash-password, airport data build
  tests/              vitest suites and fixtures
  docs/               architecture and planning
```
