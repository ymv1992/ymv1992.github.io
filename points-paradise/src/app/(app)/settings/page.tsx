import type { Metadata } from 'next'
import Link from 'next/link'
import {
  CABINS,
  CABIN_LABELS,
  CARD_TYPES,
  CATEGORY_DEFS,
  DATE_FLEXIBILITY,
  DATE_FLEXIBILITY_LABELS,
  DEAL_BREAKERS,
  DEAL_BREAKER_LABELS,
  TAG_LABELS,
  TRAVEL_TAGS,
} from '@/lib/domain/constants'
import { getDb } from '@/lib/db/client'
import { loadAccount } from '@/lib/data/account'
import { listPartners } from '@/lib/data/transfers'
import { dayStart, requestsSince, usageSummary } from '@/lib/data/usage'
import { DISCOVERY_DAILY_CAP, DISCOVERY_DESTINATIONS } from '@/lib/jobs/discovery'
import { integrationStatus } from '@/lib/server/config'
import { requireUserId } from '@/lib/server/session'
import { usd } from '@/lib/format'
import {
  createProfileAction,
  deleteAccountAction,
  deleteProfileAction,
  resetPersonalizationAction,
  saveBudgetsAction,
  saveDiscoveryAction,
  saveNotificationSettingsAction,
  saveProfileAction,
  saveValuationAction,
  saveWalletAction,
  setDemoModeAction,
  switchProfileAction,
} from '@/app/actions/settings-actions'
import { logout } from '@/app/login/actions'
import { ActionForm } from '@/components/action-form'
import { BrowserNotificationToggle } from '@/components/settings/browser-notifications'
import { Badge, Card, PageHeader, SectionTitle, buttonClass } from '@/components/ui'

export const metadata: Metadata = { title: 'Settings' }

const TRIP_STYLES = ['solo', 'romantic', 'family', 'adventure', 'weekend', 'longer vacations', 'luxury'] as const

export default async function SettingsPage() {
  const userId = await requireUserId()
  const db = await getDb()
  const { settings, wallet, profile, profiles } = await loadAccount(db, userId)
  const partners = (await listPartners(db)).filter((p) => p.active)
  const integrations = integrationStatus()
  const usage = await usageSummary(db)
  const monthSpend = usage.byProvider.reduce((s, p) => s + Number(p.cost), 0)
  const discoveryToday = await requestsSince(db, 'seats_aero', dayStart(new Date()), 'discovery')
  const destinationCount = DISCOVERY_DESTINATIONS.reduce((n, g) => n + g.airports.length, 0)

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Settings"
        title="Your points, preferences & data"
        actions={
          <form action={logout}>
            <button type="submit" className="rounded-full border border-line bg-surface px-4 py-2 text-sm">
              Sign out
            </button>
          </form>
        }
      />
      <nav aria-label="Settings sections" className="flex flex-wrap gap-2 text-sm">
        {[
          ['wallet', 'Wallet'],
          ['profile', 'Travel profile'],
          ['valuation', 'Valuation'],
          ['notifications', 'Notifications'],
          ['data', 'Data sources'],
          ['budgets', 'Budgets & AI'],
          ['privacy', 'Privacy'],
        ].map(([id, label]) => (
          <a key={id} href={`#${id}`} className="rounded-full border border-line bg-surface px-3 py-1.5 text-muted hover:text-ink">
            {label}
          </a>
        ))}
      </nav>

      <Card id="wallet" className="scroll-mt-20 p-5">
        <SectionTitle>Points wallet</SectionTitle>
        <ActionForm action={saveWalletAction}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="chaseBalance" className="label">
                Chase Ultimate Rewards balance
              </label>
              <input id="chaseBalance" name="chaseBalance" type="number" min={0} step={1} defaultValue={wallet.chaseBalance} className="field tabular" />
            </div>
            <div>
              <label htmlFor="cardType" className="label">
                Card that earns your points
              </label>
              <select id="cardType" name="cardType" defaultValue={wallet.cardType} className="field">
                {CARD_TYPES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                    {c.canTransfer ? '' : ' (no direct transfers)'}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <details>
            <summary className="cursor-pointer text-sm text-primary">Miles already in partner accounts</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {partners.map((p) => (
                <div key={p.id}>
                  <label htmlFor={`partner_${p.id}`} className="label">
                    {p.programName}
                  </label>
                  <input id={`partner_${p.id}`} name={`partner_${p.id}`} type="number" min={0} defaultValue={wallet.partnerBalances[p.id] ?? ''} className="field tabular" />
                </div>
              ))}
            </div>
          </details>
          <p className="text-xs text-muted">Last updated {wallet.updatedAt.toISOString().slice(0, 10)}. Your Chase login is never requested or stored.</p>
        </ActionForm>
      </Card>

      <Card id="profile" className="scroll-mt-20 p-5">
        <SectionTitle aside={<span className="text-xs text-muted">Shapes For You and personal match — never the value rankings</span>}>Travel profile</SectionTitle>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {profiles.map((p) => (
            <form key={p.id} action={switchProfileAction.bind(null, p.id)} className="flex items-center">
              <button type="submit" className={p.id === profile.id ? 'rounded-full bg-primary px-3 py-1.5 text-sm text-primary-ink' : 'rounded-full border border-line bg-surface px-3 py-1.5 text-sm'} aria-pressed={p.id === profile.id}>
                {p.name}
              </button>
            </form>
          ))}
          {profiles.length > 1 &&
            profiles
              .filter((p) => p.id !== profile.id)
              .map((p) => (
                <form key={`del-${p.id}`} action={deleteProfileAction.bind(null, p.id)}>
                  <button type="submit" className="text-xs text-danger underline-offset-2 hover:underline">
                    Delete “{p.name}”
                  </button>
                </form>
              ))}
        </div>
        <ActionForm action={saveProfileAction.bind(null, profile.id)} submitLabel="Save profile">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="pname" className="label">
                Profile name
              </label>
              <input id="pname" name="name" defaultValue={profile.name} className="field" required maxLength={60} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="homeAirports" className="label">
                Home airports (comma separated)
              </label>
              <input id="homeAirports" name="homeAirports" defaultValue={profile.homeAirports.join(', ')} className="field uppercase" />
            </div>
            <div>
              <label htmlFor="maxCashUsd" className="label">
                Max additional cash per trip (USD)
              </label>
              <input id="maxCashUsd" name="maxCashUsd" type="number" min={0} defaultValue={profile.maxCashUsd} className="field" />
            </div>
            <div>
              <label htmlFor="maxPoints" className="label">
                Max points per trip
              </label>
              <input id="maxPoints" name="maxPoints" type="number" min={0} defaultValue={profile.maxPoints ?? ''} className="field" />
            </div>
            <div>
              <label htmlFor="maxFlightHours" className="label">
                Max flight time (hours)
              </label>
              <input id="maxFlightHours" name="maxFlightHours" type="number" min={0} step={0.5} defaultValue={profile.maxFlightHours ?? ''} className="field" />
            </div>
            <div>
              <label htmlFor="tripNightsMin" className="label">
                Preferred nights (min)
              </label>
              <input id="tripNightsMin" name="tripNightsMin" type="number" min={0} defaultValue={profile.tripNightsMin ?? ''} className="field" />
            </div>
            <div>
              <label htmlFor="tripNightsMax" className="label">
                Preferred nights (max)
              </label>
              <input id="tripNightsMax" name="tripNightsMax" type="number" min={0} defaultValue={profile.tripNightsMax ?? ''} className="field" />
            </div>
            <div>
              <label htmlFor="dateFlexibility" className="label">
                Date flexibility
              </label>
              <select id="dateFlexibility" name="dateFlexibility" defaultValue={profile.dateFlexibility} className="field">
                {DATE_FLEXIBILITY.map((f) => (
                  <option key={f} value={f}>
                    {DATE_FLEXIBILITY_LABELS[f]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <fieldset>
            <legend className="label">What you enjoy</legend>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {TRAVEL_TAGS.map((t) => (
                <label key={t} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-1.5 text-sm">
                  {TAG_LABELS[t]}
                  <select name={`tag_${t}`} defaultValue={String(profile.tagPreferences[t] ?? 0)} className="rounded-md border border-line bg-surface px-1 py-0.5 text-xs" aria-label={`${TAG_LABELS[t]} preference`}>
                    <option value="2">Love</option>
                    <option value="1">Like</option>
                    <option value="0">Neutral</option>
                    <option value="-1">Avoid</option>
                  </select>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="label">Trip styles</legend>
            <div className="flex flex-wrap gap-3 text-sm">
              {TRIP_STYLES.map((s) => (
                <label key={s} className="flex items-center gap-1.5 capitalize">
                  <input type="checkbox" name="tripStyles" value={s} defaultChecked={profile.tripStyles.includes(s)} /> {s}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="dreamDestinations" className="label">
                Dream destinations
              </label>
              <textarea id="dreamDestinations" name="dreamDestinations" defaultValue={profile.dreamDestinations.join(', ')} className="field" placeholder="Maldives, Kyoto, Patagonia" />
            </div>
            <div>
              <label htmlFor="visited" className="label">
                Places already visited
              </label>
              <textarea id="visited" name="visited" defaultValue={profile.visited.join(', ')} className="field" placeholder="Paris, Mexico City" />
            </div>
          </div>
          <fieldset>
            <legend className="label">Hard deal-breakers</legend>
            <div className="flex flex-wrap gap-3 text-sm">
              {DEAL_BREAKERS.map((d) => (
                <label key={d} className="flex items-center gap-1.5">
                  <input type="checkbox" name="dealBreakers" value={d} defaultChecked={profile.dealBreakers.includes(d)} /> {DEAL_BREAKER_LABELS[d]}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="label">Preferred deal categories</legend>
            <div className="flex flex-wrap gap-3 text-sm">
              {CATEGORY_DEFS.map((c) => (
                <label key={c.slug} className="flex items-center gap-1.5">
                  <input type="checkbox" name="preferredCategories" value={c.slug} defaultChecked={profile.preferredCategories.includes(c.slug)} /> {c.label}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="preferNewPlaces" defaultChecked={profile.preferNewPlaces} /> Prefer places I haven&apos;t visited
          </label>
          {Object.keys(profile.learnedWeights).length > 0 && (
            <p className="text-xs text-muted">
              Learned from your swipes:{' '}
              {Object.entries(profile.learnedWeights)
                .filter(([, w]) => Math.abs(w) >= 0.1)
                .sort((a, b) => b[1] - a[1])
                .map(([t, w]) => `${TAG_LABELS[t as keyof typeof TAG_LABELS] ?? t} ${w > 0 ? '+' : ''}${w.toFixed(2)}`)
                .join(' · ') || 'nothing significant yet'}
            </p>
          )}
        </ActionForm>
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-primary">Create another profile (e.g. “Romantic getaways”, “Solo adventures”)</summary>
          <div className="mt-3">
            <ActionForm action={createProfileAction} submitLabel="Create profile" className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="newProfile" className="label">
                  Name
                </label>
                <input id="newProfile" name="name" required maxLength={60} className="field" />
              </div>
            </ActionForm>
          </div>
        </details>
      </Card>

      <Card id="valuation" className="scroll-mt-20 p-5">
        <SectionTitle>Valuation</SectionTitle>
        <ActionForm action={saveValuationAction}>
          <div className="grid gap-3 sm:grid-cols-4">
            <div>
              <label htmlFor="pointFloorCents" className="label">
                Floor value per point (¢)
              </label>
              <input id="pointFloorCents" name="pointFloorCents" type="number" step={0.05} min={0} defaultValue={settings.pointFloorCents} className="field" />
            </div>
            <div>
              <label htmlFor="minAcceptableCpp" className="label">
                Target value per point (¢)
              </label>
              <input id="minAcceptableCpp" name="minAcceptableCpp" type="number" step={0.05} min={0} defaultValue={settings.minAcceptableCpp} className="field" />
            </div>
            <div>
              <label htmlFor="foodPerPersonPerDayUsd" className="label">
                Food estimate / person / day
              </label>
              <input id="foodPerPersonPerDayUsd" name="foodPerPersonPerDayUsd" type="number" min={0} defaultValue={settings.foodPerPersonPerDayUsd} className="field" />
            </div>
            <div>
              <label htmlFor="travelers" className="label">
                Travelers
              </label>
              <input id="travelers" name="travelers" type="number" min={1} max={12} defaultValue={settings.travelers} className="field" />
            </div>
          </div>
          <p className="text-xs text-muted">
            The floor is what a point is always worth to you elsewhere (1¢ = cashing out); redemptions below it are flagged. The target is the value you consider worth transferring for.
          </p>
        </ActionForm>
      </Card>

      <Card id="notifications" className="scroll-mt-20 p-5">
        <SectionTitle aside={<Link href="/alerts#preferences" className="text-sm text-primary">Alert criteria</Link>}>Notifications</SectionTitle>
        <ActionForm action={saveNotificationSettingsAction}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="notificationEmail" className="label">
                Alert email
              </label>
              <input id="notificationEmail" name="notificationEmail" type="email" defaultValue={settings.notificationEmail ?? ''} className="field" />
            </div>
            <div>
              <label htmlFor="timezone" className="label">
                Your time zone
              </label>
              <input id="timezone" name="timezone" defaultValue={settings.timezone} className="field" placeholder="America/Los_Angeles" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="emailEnabled" defaultChecked={settings.emailEnabled} /> Send alerts by email {!integrations.email && <Badge tone="warn">Email provider not configured</Badge>}
          </label>
          <BrowserNotificationToggle defaultChecked={settings.browserNotifications} />
        </ActionForm>
      </Card>

      <Card id="data" className="scroll-mt-20 p-5">
        <SectionTitle aside={<Link href="/settings/usage" className="text-sm text-primary">Usage dashboard</Link>}>Data sources</SectionTitle>
        <ActionForm action={setDemoModeAction} submitLabel="Apply demo setting" className="mb-6 space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="demoMode" defaultChecked={settings.demoMode} /> Show demo data (fictional, always labelled DEMO, never ranked as bookable)
          </label>
        </ActionForm>
        <div id="discovery" className="mb-6 scroll-mt-20 rounded-xl border border-line p-4">
          <h3 className="font-semibold">Automatic discovery</h3>
          <p className="mt-1 text-sm text-muted">
            Once a day, looks up open award seats from your home airports ({profile.homeAirports.join(', ') || 'SAN, LAX, SNA, ONT, BUR'}) to {destinationCount} popular destinations and
            any dream destinations it can match to an airport, across the Chase airline partners seats.aero covers. New finds appear in Discover.
          </p>
          <p className="mt-2 text-sm">
            {integrations.seatsAero ? (
              <>
                Uses at most {DISCOVERY_DAILY_CAP} of the 1,000 daily lookups included in seats.aero Pro, so it adds no cost beyond the subscription. Used today:{' '}
                <span className="tabular font-semibold">{discoveryToday}</span> of {DISCOVERY_DAILY_CAP}.
              </>
            ) : (
              <>Needs a seats.aero Pro API key (see below). Until one is added, nothing is searched and nothing is charged.</>
            )}
          </p>
          <ActionForm action={saveDiscoveryAction} submitLabel="Save discovery settings" className="mt-3 space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="discoveryEnabled" defaultChecked={settings.discoveryEnabled} /> Search automatically every day
            </label>
            <fieldset className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
              <legend className="mb-1 text-muted">Cabins to look for</legend>
              {CABINS.map((c) => (
                <label key={c} className="flex items-center gap-2">
                  <input type="checkbox" name="discoveryCabins" value={c} defaultChecked={settings.discoveryCabins.includes(c)} /> {CABIN_LABELS[c]}
                </label>
              ))}
            </fieldset>
          </ActionForm>
        </div>
        <ul className="divide-y divide-line rounded-xl border border-line">
          {usage.sources.map((s) => {
            const configured =
              s.id === 'seats_aero' ? integrations.seatsAero : s.id.startsWith('serpapi') ? integrations.serpApi : s.id === 'resend' ? integrations.email : s.id === 'anthropic' ? integrations.ai : s.id === 'unsplash' ? integrations.unsplash : s.id === 'rss_announcements' ? integrations.rss : null
            return (
              <li key={s.id} className="p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{s.name}</span>
                  {configured === true && <Badge tone="ok">Configured</Badge>}
                  {configured === false && <Badge>Not configured</Badge>}
                  {s.healthStatus === 'discontinued' && <Badge tone="danger">Discontinued</Badge>}
                  {s.healthStatus === 'failing' && <Badge tone="danger">Failing</Badge>}
                </div>
                <p className="text-muted">
                  {s.sourceType} · {s.freeTier}
                </p>
                <details className="mt-1 text-xs text-muted">
                  <summary className="cursor-pointer text-primary">Access, limits &amp; restrictions</summary>
                  <dl className="mt-1 grid gap-x-4 gap-y-0.5 sm:grid-cols-[160px_1fr]">
                    <dt>Authentication</dt>
                    <dd>{s.authRequirements}</dd>
                    <dt>Rate limits</dt>
                    <dd>{s.rateLimits}</dd>
                    <dt>Usage restrictions</dt>
                    <dd>{s.usageRestrictions}</dd>
                    <dt>Freshness</dt>
                    <dd>{s.freshness}</dd>
                    <dt>Reliability</dt>
                    <dd>{s.reliability}</dd>
                    {s.cacheTtlHours != null && (
                      <>
                        <dt>Cache duration</dt>
                        <dd>{s.cacheTtlHours} hours</dd>
                      </>
                    )}
                    <dt>Last success</dt>
                    <dd>{s.lastSuccessAt ? s.lastSuccessAt.toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : 'Never'}</dd>
                    {s.lastError && (
                      <>
                        <dt>Last error</dt>
                        <dd className="text-danger">{s.lastError}</dd>
                      </>
                    )}
                    {s.docsUrl && (
                      <>
                        <dt>Documentation</dt>
                        <dd>
                          <a className="text-primary underline" href={s.docsUrl} target="_blank" rel="noopener noreferrer">
                            {s.docsUrl}
                          </a>
                        </dd>
                      </>
                    )}
                    {s.notes && (
                      <>
                        <dt>Notes</dt>
                        <dd>{s.notes}</dd>
                      </>
                    )}
                  </dl>
                </details>
              </li>
            )
          })}
        </ul>
        <p className="mt-3 text-xs text-muted">API keys are read from server environment variables and never sent to the browser. See the README for how to enable each provider.</p>
      </Card>

      <Card id="budgets" className="scroll-mt-20 p-5">
        <SectionTitle aside={<span className="tabular text-sm text-muted">This month: {usd(monthSpend, { cents: true })}</span>}>Budgets &amp; AI</SectionTitle>
        <ActionForm action={saveBudgetsAction}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="monthlyApiBudgetUsd" className="label">
                Monthly cap for paid data requests (USD)
              </label>
              <input id="monthlyApiBudgetUsd" name="monthlyApiBudgetUsd" type="number" min={0} step={0.5} defaultValue={settings.monthlyApiBudgetUsd} className="field" />
            </div>
            <div>
              <label htmlFor="aiMonthlyBudgetUsd" className="label">
                Monthly cap for AI (USD)
              </label>
              <input id="aiMonthlyBudgetUsd" name="aiMonthlyBudgetUsd" type="number" min={0} step={0.5} defaultValue={settings.aiMonthlyBudgetUsd} className="field" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="aiEnabled" defaultChecked={settings.aiEnabled} /> Enable AI explanations, destination ideas and trip narratives{' '}
            {!integrations.ai && <Badge tone="warn">ANTHROPIC_API_KEY not set</Badge>}
          </label>
          <p className="text-xs text-muted">AI never produces prices, availability or calculations — only prose from facts the app computed.</p>
        </ActionForm>
      </Card>

      <Card id="privacy" className="scroll-mt-20 p-5">
        <SectionTitle>Privacy &amp; data</SectionTitle>
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <a href="/api/export" download className={buttonClass('secondary')}>
              Download my data (JSON)
            </a>
            <span className="text-xs text-muted">Profiles, wallet, saved deals, notes, alerts, history and deals you entered.</span>
          </div>
          <ActionForm action={resetPersonalizationAction} submitLabel="Reset personalization" className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-muted">Clears learned preferences, ratings and passes (passed deals reappear).</span>
          </ActionForm>
          <ActionForm action={deleteAccountAction} submitLabel="Permanently delete my data" className="space-y-3 rounded-xl border border-danger/40 bg-danger-soft/40 p-4">
            <p className="text-sm">
              Deletes your account, profiles, saved deals, alerts and history from this database. Transfer-partner reference data is kept. This cannot be undone.
            </p>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="includeManualDeals" /> Also delete deals I entered manually
            </label>
            <div>
              <label htmlFor="confirm" className="label">
                Type DELETE to confirm
              </label>
              <input id="confirm" name="confirm" className="field max-w-48" autoComplete="off" />
            </div>
          </ActionForm>
        </div>
      </Card>
    </div>
  )
}
