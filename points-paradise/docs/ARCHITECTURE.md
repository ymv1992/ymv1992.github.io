# Points & Paradise — architecture

A private, single-owner web app that finds, values, ranks and tracks Chase
Ultimate Rewards travel redemptions. It never books, transfers points, pays,
or stores loyalty-program passwords; it tells you what is worth doing and
walks you through doing it yourself.

This document covers the ten planning deliverables. Setup and deployment are
in [`../README.md`](../README.md).

---

## 1. Product architecture

```
 Browser (PWA, mobile-first)
   │  server-rendered pages + server actions (no client-side secrets)
   ▼
 Next.js 16 App Router (Vercel)
   ├─ proxy.ts ............ signed-cookie route guard (redirects to /login)
   ├─ app/(app)/* ......... pages: Discover, Top 100, Saved, Transfer Center …
   ├─ app/actions/* ....... server actions — every one calls requireUserId()
   ├─ app/api/cron/[job] .. scheduled jobs (Bearer CRON_SECRET)
   └─ app/api/export ...... full JSON export of your data
        │
        ▼
 lib/data/*  (data layer: queries, snapshots, notifications, usage logging)
        │                         │
        ▼                         ▼
 lib/engine/* (pure TypeScript)   lib/providers/* (server-only)
   valuation · comparability       seats.aero cached search
   transfer math · ranking         SerpApi Google Flights / Hotels
   deadlines · status · history    Unsplash photos · RSS announcements
   personalization · positioning   Resend email · Anthropic (prose only)
   budget gates · priority queue
   trip builder · booking guide
        │
        ▼
 Postgres (Supabase) via Drizzle — or PGlite (embedded Postgres) for local dev
```

Principles that shape the code:

- **Every number is computed by deterministic code.** The engine
  (`src/lib/engine`) has no I/O and is unit-tested. AI is only ever handed
  computed facts and asked to write prose; its output is labelled
  "AI-written".
- **Evidence travels with every deal.** Each deal records its source kind
  (`api`, `manual`, `announcement`, `research`, `demo`, `prediction`), when
  it was observed, and its deadline type (`confirmed`, `observed`,
  `estimated`, `none`). Rankings and labels are derived from that evidence,
  so an unverified, expired or demo deal can never be presented as bookable.
- **Refuse instead of guessing.** When cash and award products are not
  comparable (different route, dates, cabin or room), the value shows
  "Value cannot be reliably calculated" with the reasons, not a number.
- **Free first.** Every provider is optional, off until its key is set,
  cached, rate-limited, and gated by a monthly spend cap.

## 2. Stack and reasons

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router) + TypeScript | Server components keep provider keys on the server; server actions remove the need for a hand-written API; first-class on Vercel's free tier. |
| Styling | Tailwind CSS v4 with CSS-variable design tokens | Light/dark themes from one token set; no runtime CSS-in-JS. |
| Database | Postgres via Drizzle ORM | One typed schema for Supabase (production) and PGlite (local/tests), with real SQL migrations. |
| Local DB | PGlite (embedded Postgres) | `npm run dev` works with zero services; tests run against real Postgres semantics in memory. |
| Validation | zod 4 | Every form, import, API response and AI response is parsed before use. |
| Auth | Owner email + scrypt hash in env, HMAC-signed session cookie | Single user; no third-party auth service to configure or pay for; nothing to leak from the database. |
| Email | Resend (HTTP API) | Generous free tier, no SDK needed. |
| AI | Anthropic Claude API (official SDK), structured outputs | Optional; prose only; cached and budget-capped. Default model is the low-cost Haiku tier, overridable with `ANTHROPIC_MODEL`. |
| Maps/charts | d3-geo + world-atlas, hand-built SVG charts | No map tile service or API key; charts have tooltips, keyboard access and table views. |
| Scheduling | Vercel Cron (daily) + optional GitHub Actions (hourly) | Both free. |
| PWA | Web manifest + minimal service worker | Installable on a phone; the worker only serves an offline page and never caches deal data. |

## 3. Operating cost estimate (target: $0–15/month)

Prices change; confirm each provider's current pricing before relying on
these figures.

| Item | Plan | Monthly cost |
|---|---|---|
| Hosting | Vercel Hobby (personal, non-commercial use) | $0 |
| Database | Supabase Free (500 MB; projects pause after about a week without activity — the daily job usually keeps it active) | $0 |
| Email | Resend Free (daily and monthly send limits) | $0 |
| Photos | Unsplash (free; rate-limited demo key) | $0 |
| Announcements | Public RSS feeds | $0 |
| Cash fares | SerpApi free allowance (small monthly quota) | $0 |
| AI prose | Anthropic API, capped in-app (default $2/month) | $0–2 |
| Award availability | seats.aero Pro (optional; $9.99/month or $99.99/year in the US as reported Oct 2026; API calls included) | $0 or ~$10 |
| **Total** | | **$0 baseline; about $10–12 with seats.aero and AI** |

Cost controls built in: per-provider daily/monthly quotas from the data-source
registry, a monthly paid-API cap (default $5) and a separate AI cap
(default $2) that pause requests at 95% of the cap, response caching
(12–24 h for searches, 30 days for photos, keyed caching for AI), a priority
queue that spends scarce calls on saved deals and urgent deadlines first,
automatic discovery capped at 100 of seats.aero's 1,000 included daily calls
(with 200 always left for watches and searches), and a usage dashboard at
**Settings → Usage**.

## 4. Free vs paid comparison

| Capability | Free setup | With paid add-ons |
|---|---|---|
| Deals | Manual entry, JSON/CSV import, RSS leads, demo data | + automatic daily discovery from your home airports and seats.aero availability on watched routes |
| Value (CPP) | From cash prices you enter | + automatic comparable cash fares/rates (SerpApi beyond the free quota) |
| Award calendar | Built from deals and observations you add | Filled automatically by watch checks |
| Alerts | In-app, browser (while open) and email | Same, with more frequent automated watch checks |
| AI | Off — every feature still works without it | Deal explanations, destination ideas, trip narratives |
| Scheduling | Daily (Vercel Hobby) + hourly via GitHub Actions | Same |

## 5. Licensing and access limits

- **Chase** has no public API for balances, transfers or the Chase Travel
  portal. Balances, card type, portal prices and promotions are entered by
  you; the app links to chase.com and gives step-by-step instructions.
- **seats.aero** Pro API: personal, non-commercial use only without written
  permission; about 1,000 calls/day; cached search only (Live Search is not
  included for Pro). Results are cached data and are labelled with their
  update time.
- **SerpApi**: a third-party search API with its own terms; review them
  before enabling. Results reflect Google at search time and are used only
  as comparable cash prices.
- **Airline and hotel websites** are not scraped. No CAPTCHA, paywall or
  login is bypassed. No loyalty passwords are requested or stored.
- **Amadeus Self-Service** was reported shut down for new self-service
  access in July 2026; it is listed in the source registry as discontinued
  and not used.
- **Unsplash**: photos are hotlinked with photographer credit as its API
  terms require; they illustrate destinations, not specific properties.
- **RSS**: only titles, links and dates are stored. Items become unverified
  leads for you to review.
- **Transfer partner data** was compiled from secondary reporting on
  2026-10-18 and is stored as `research_seed`, not verified. Confirm ratios
  in your Chase account and mark partners verified in the Transfer Center.

Every source, with its auth, quota, restrictions and health, is shown at
**Settings → Data sources** (table `data_sources`); spend and request counts are at **Settings → Usage**.

## 6. Schema

Defined in `src/lib/db/schema.ts`; migrations in `drizzle/`. Migration
`0001_security_and_checks.sql` enables row-level security on every table
(no policies, so Supabase's public `anon`/`authenticated` roles can read
nothing) and adds check constraints (non-negative points and cash, valid
enums, ordered dates, rating ranges, sane transfer ratios).

| Table | Purpose |
|---|---|
| `users` | The owner (email, onboarding state). |
| `auth_attempts` | Failed-login log for rate limiting. |
| `user_settings` | Home airports, budgets, CPP floor, time zone, notification channels, alert preferences, API and AI spend caps, feature toggles. |
| `points_wallets` | Chase balance and card type (no card numbers). |
| `travel_profiles` | Personality profile: tag preferences, trip styles, dream and visited destinations, learned weights. |
| `transfer_partners` | Ratios, card-specific overrides, minimums, increments, rounding, processing times, verification status, sources. |
| `transfer_promotions` | Bonuses with start/end instants and their time zone, eligibility, source and verification status. |
| `deals` | Every opportunity: flight/hotel/package fields, program and Chase-portal prices, comparable cash, evidence, deadline type, dedupe key, cached metrics, archive state. |
| `deal_price_history` | Price and availability observations used for history, calendar and predictions. |
| `collections`, `saved_deals`, `saved_deal_collections` | Saved deals with notes, ratings, snapshots at save time, and collection membership (9 defaults plus your own). |
| `watchlists` | Route, property and "similar deal" watches with refresh intervals and thresholds. |
| `notifications` | Alerts with a unique dedupe key, delivery status, quiet-hours deferral and digest state. |
| `feedback` | Save/pass/rating signals that train personalization (resettable). |
| `search_history` | Searches you ran. |
| `search_jobs` | Every provider call: status (succeeded, failed, skipped for budget/quota/configuration), cost, timing — the source of the usage dashboard. |
| `data_sources` | Source registry: auth, free tier, quotas, restrictions, cache TTL, health. |
| `announcements` | RSS leads awaiting review. |
| `media_cache` | Cached destination photos with attribution. |
| `app_state` | Small key/value store for job bookkeeping. |

## 7. Page map

| Route | Page |
|---|---|
| `/login`, `/onboarding` | Sign in; first-run setup (airports, points, budget, card, style, dream places). |
| `/discover` | Swipeable cards (Save / Pass / Details / Undo), ten feed modes, list mode. |
| `/top` | Top 100 with filters and sorts; every rank explains itself. |
| `/categories`, `/categories/[slug]` | Category leaderboards (business class, resort stays, transfer bonuses, under 50k …). |
| `/explore` | World map of destinations with deals; AI destination ideas (optional). |
| `/calendar` | Award calendar heatmap, price history chart, seasonal table, evidence-tiered prediction; cached award search when seats.aero is configured. |
| `/deals/[id]` | Deal detail: value breakdown, transfer plan, comparability, booking checklist, aircraft/room verification, countdown, history. |
| `/deals/new`, `/deals/[id]/edit`, `/deals/import` | Manual entry and JSON/CSV import with validation. |
| `/saved`, `/saved/compare` | Collections, notes, snapshots vs current, side-by-side comparison. |
| `/trip-architect` | Plain-English trip request → complete or clearly-incomplete plans within your points and cash. |
| `/transfers` | Partner directory, promotions, transfer calculator with advisability. |
| `/positioning` | Positioning-flight optimizer with cost breakdown and separate-ticket warnings. |
| `/alerts` | Notifications, alert preferences, watches, RSS leads, "Run checks now". |
| `/history` | Missed and expired deals archive with "watch for similar". |
| `/settings`, `/settings/usage` | Preferences, integrations status, export/delete; usage and data-source dashboard. |
| `/me` | Profile summary (mobile "Profile" tab). |

Mobile bottom bar: Discover, Rankings, Saved, Explore, Profile. Desktop:
grouped sidebar with every page.

## 8. Phases

| Phase | Scope | Status |
|---|---|---|
| 1 — Foundation | Auth, schema/migrations, valuation and transfer engine, manual deals, Discover, Top 100, categories, deal detail, Transfer Center, labelled demo data, onboarding | Done |
| 2 — Tracking | Saved collections and snapshots, deadlines and reminders, alerts with dedupe/quiet hours/digest, email, cron, history archive | Done |
| 3 — Data | seats.aero, SerpApi, Unsplash, RSS, award calendar, positioning optimizer, usage dashboard | Done (each provider needs its key) |
| 4 — Intelligence | Personality engine, Trip Architect, predictions, AI explanations/ideas/narratives | Done (AI optional) |
| 5 — Multi-user | — | Not built, by design |

## 9. Risks

| Risk | Mitigation |
|---|---|
| Stale or wrong prices | Every deal shows its source and age; stale deals drop out of "bookable" ranking; booking checklist says to confirm on the official site. |
| Transfer terms change (e.g. the reported Hyatt 4:3 change for some cards) | Card-specific ratio overrides; research data marked unverified; partner editor; "never transfer speculatively" warnings. |
| Provider terms or pricing change | Each provider is optional and isolated; the source registry records restrictions; quotas and spend caps. |
| Surprise API bills | 95% spend-cap gate, per-provider quotas, caching, priority queue, usage dashboard. |
| Supabase free project pauses | Daily cron activity; README explains how to resume. |
| Deadline mistakes across time zones/DST | Deadlines stored as instants plus their zone; zoned parsing helpers; tests cover DST. Countdowns only for confirmed deadlines. |
| AI states something false | AI gets only computed facts, never prices to invent; output labelled; can be disabled; never used for numbers. |
| Single password | Long passphrase (scrypt), login rate limiting, signed 14-day session, HttpOnly/SameSite cookie, HTTPS on Vercel. |
| PGlite used in production by mistake | Production refuses PGlite unless `ALLOW_PGLITE=true`. |

## 10. Features that depend on data

These are fully implemented but only as good as the data you feed them. With
no provider keys, they work from manual entries and imports.

- **Discover** fills itself once seats.aero is configured (automatic
  discovery). **Rankings** need deals with both a points price and a
  comparable cash price; discovered awards get one from SerpApi (a few a
  day on the free tier) or from you.
- **Award calendar and predictions** need repeated observations of the same
  route or property; predictions are withheld until there is enough history
  and always show their evidence tier.
- **Price-drop and availability alerts** need watches that a provider can
  check (seats.aero for award routes) or snapshots you update.
- **Positioning optimizer** needs deals from more than one origin airport.
- **Trip Architect** combines existing deals; a trip with missing legs is
  labelled incomplete, never filled with invented flights.
- **Personalization** learns from your saves, passes and ratings.
