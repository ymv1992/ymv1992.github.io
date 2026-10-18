import type { Metadata } from 'next'
import Link from 'next/link'
import { desc, eq } from 'drizzle-orm'
import { announcements } from '@/lib/db/schema'
import { CABINS, CABIN_LABELS, REMINDER_OFFSETS } from '@/lib/domain/constants'
import { ALERT_EVENT_LABELS, ALERT_EVENT_TYPES } from '@/lib/engine/notify'
import { DEFAULT_ALERT_PREFS } from '@/lib/data/account'
import { listNotifications } from '@/lib/data/notifications'
import { listWatches } from '@/lib/data/watchlists'
import { formatAge } from '@/lib/engine/status'
import { integrationStatus } from '@/lib/server/config'
import { getEvaluation } from '@/lib/server/loaders'
import { programOptions } from '@/lib/view/programs'
import {
  createWatchAction,
  deleteWatchAction,
  dismissAnnouncementAction,
  markAllReadAction,
  markReadAction,
  saveAlertPrefsAction,
  toggleWatchAction,
} from '@/app/actions/alert-actions'
import { ActionForm } from '@/components/action-form'
import { RunChecksButton } from '@/components/alerts/run-checks'
import { Badge, Card, ExternalLink, PageHeader, SectionTitle } from '@/components/ui'

export const metadata: Metadata = { title: 'Alerts' }

export default async function AlertsPage() {
  const data = await getEvaluation()
  const now = data.ctx.now
  const [items, watches, inbox] = await Promise.all([
    listNotifications(data.db, data.userId, 100),
    listWatches(data.db, data.userId),
    data.db.select().from(announcements).where(eq(announcements.status, 'new')).orderBy(desc(announcements.createdAt)).limit(30),
  ])
  const prefs = data.account.settings.alertPrefs ?? DEFAULT_ALERT_PREFS
  const unread = items.filter((n) => !n.readAt && n.status === 'sent').length
  const integrations = integrationStatus()
  const programs = programOptions(data.partners.values()).filter((p) => p.id !== 'chase_travel')

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Alerts"
        title="Alert command center"
        subtitle="Every alert links to its deal and is sent at most once. Deadlines and price changes are checked on the schedule — or right now."
        actions={<RunChecksButton />}
      />
      {!integrations.cron && (
        <p className="rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">
          Scheduled checks are not configured (CRON_SECRET is not set), so alerts only update when you press “Run checks now”. See the README to enable the schedule.
        </p>
      )}

      <section>
        <SectionTitle
          aside={
            unread > 0 && (
              <form action={markAllReadAction}>
                <button type="submit" className="text-sm text-primary">
                  Mark all read
                </button>
              </form>
            )
          }
        >
          Notifications {unread > 0 && <Badge tone="gold">{unread} unread</Badge>}
        </SectionTitle>
        {items.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">No alerts yet. Save deals, add watches, or record a transfer bonus to start receiving them.</p>
        ) : (
          <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
            {items.map((n) => (
              <li key={n.id} className={n.readAt ? 'flex gap-3 p-4 opacity-70' : 'flex gap-3 p-4'}>
                <span aria-hidden className={n.readAt ? 'mt-1.5 size-2 shrink-0 rounded-full bg-line' : 'mt-1.5 size-2 shrink-0 rounded-full bg-gold'} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={n.link} className="font-semibold hover:text-primary">
                      {n.title}
                    </Link>
                    <Badge>{ALERT_EVENT_LABELS[n.eventType as keyof typeof ALERT_EVENT_LABELS] ?? n.eventType}</Badge>
                    {n.status === 'deferred' && <Badge tone="warn">Held for quiet hours</Badge>}
                    {n.status === 'digest' && <Badge tone="primary">In next digest</Badge>}
                  </div>
                  <p className="text-sm text-muted">{n.body}</p>
                  <p className="text-xs text-faint">
                    {formatAge(n.createdAt, now)}
                    {n.emailStatus && n.emailStatus !== 'not_configured' && ` · email ${n.emailStatus}`}
                  </p>
                </div>
                {!n.readAt && (
                  <form action={markReadAction.bind(null, n.id)}>
                    <button type="submit" className="text-xs text-muted hover:text-ink">
                      Mark read
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionTitle>Watches</SectionTitle>
        {watches.length > 0 && (
          <ul className="mb-4 divide-y divide-line rounded-2xl border border-line bg-surface text-sm">
            {watches.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {w.dealId ? <Link href={`/deals/${w.dealId}`}>{w.label}</Link> : w.label}{' '}
                    {w.autoCheckSupported ? <Badge tone="primary">Auto-checks via {w.provider}</Badge> : <Badge>Manual checks only</Badge>}
                    {!w.active && <Badge tone="warn">Paused</Badge>}
                  </p>
                  <p className="text-xs text-muted">
                    {[w.origins.join(', '), w.destinations.join(', ')].filter(Boolean).join(' → ') || w.property}
                    {w.cabin && ` · ${CABIN_LABELS[w.cabin as keyof typeof CABIN_LABELS]}`}
                    {w.dateFrom && ` · ${w.dateFrom}${w.dateTo ? ` to ${w.dateTo}` : ''}`} · every {w.refreshHours} h · last checked {formatAge(w.lastCheckedAt, now)}
                  </p>
                  {w.lastError && <p className="text-xs text-danger">Last error: {w.lastError}</p>}
                </div>
                <form action={toggleWatchAction.bind(null, w.id, !w.active)}>
                  <button type="submit" className="text-xs text-primary">
                    {w.active ? 'Pause' : 'Resume'}
                  </button>
                </form>
                <form action={deleteWatchAction.bind(null, w.id)}>
                  <button type="submit" className="text-xs text-danger">
                    Delete
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <Card className="p-5">
          <h3 className="font-semibold">New watch</h3>
          <p className="mb-3 text-sm text-muted">
            {integrations.seatsAero
              ? 'Route watches are re-checked through the seats.aero cached search within your daily request quota.'
              : 'Automatic re-checks need a seats.aero Pro API key (see Settings → Data sources). Until then, watches act as a checklist and alert you to manual changes.'}
          </p>
          <ActionForm action={createWatchAction} submitLabel="Create watch" className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="w-kind" className="label">
                Watch a
              </label>
              <select id="w-kind" name="kind" className="field" defaultValue="route">
                <option value="route">Flight route</option>
                <option value="property">Hotel</option>
                <option value="similar">Similar deals</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="w-label" className="label">
                Name
              </label>
              <input id="w-label" name="label" required maxLength={120} className="field" placeholder="e.g. Tokyo in business, spring" />
            </div>
            <div>
              <label htmlFor="w-origins" className="label">
                From (airports)
              </label>
              <input id="w-origins" name="origins" className="field uppercase" defaultValue={data.account.profile.homeAirports.join(', ')} />
            </div>
            <div>
              <label htmlFor="w-dest" className="label">
                To (airports)
              </label>
              <input id="w-dest" name="destinations" className="field uppercase" placeholder="HND, NRT" />
            </div>
            <div>
              <label htmlFor="w-property" className="label">
                Hotel (property watches)
              </label>
              <input id="w-property" name="property" className="field" />
            </div>
            <div>
              <label htmlFor="w-program" className="label">
                Program
              </label>
              <select id="w-program" name="programId" className="field" defaultValue="">
                <option value="">Any Chase partner</option>
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="w-cabin" className="label">
                Cabin
              </label>
              <select id="w-cabin" name="cabin" className="field" defaultValue="business">
                <option value="">Any</option>
                {CABINS.map((c) => (
                  <option key={c} value={c}>
                    {CABIN_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="w-max" className="label">
                Max partner points
              </label>
              <input id="w-max" name="maxProgramPoints" type="number" min={0} className="field" />
            </div>
            <div>
              <label htmlFor="w-from" className="label">
                Travel from
              </label>
              <input id="w-from" name="dateFrom" type="date" className="field" />
            </div>
            <div>
              <label htmlFor="w-to" className="label">
                Travel to
              </label>
              <input id="w-to" name="dateTo" type="date" className="field" />
            </div>
            <div>
              <label htmlFor="w-refresh" className="label">
                Check every (hours)
              </label>
              <input id="w-refresh" name="refreshHours" type="number" min={6} max={336} defaultValue={24} className="field" />
            </div>
            <input type="hidden" name="minCpp" value="" />
          </ActionForm>
        </Card>
      </section>

      {inbox.length > 0 && (
        <section>
          <SectionTitle>Announcement inbox</SectionTitle>
          <p className="mb-3 text-sm text-muted">Public posts mentioning Chase points. These are unverified leads — open the source, then add a deal or record a bonus if it checks out.</p>
          <ul className="divide-y divide-line rounded-2xl border border-line bg-surface text-sm">
            {inbox.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <ExternalLink href={a.url}>{a.title}</ExternalLink>
                  <p className="text-xs text-faint">
                    {new URL(a.feedUrl).hostname} · {a.publishedAt ? formatAge(a.publishedAt, now) : 'date unknown'} · matched: {a.matchedKeywords.join(', ')}
                  </p>
                </div>
                <Link className="text-xs text-primary" href={`/deals/new?sourceUrl=${encodeURIComponent(a.url)}&sourceName=${encodeURIComponent(new URL(a.feedUrl).hostname)}&note=${encodeURIComponent(a.title)}`}>
                  Add as a lead
                </Link>
                <Link className="text-xs text-primary" href="/transfers">
                  Record a bonus
                </Link>
                <form action={dismissAnnouncementAction.bind(null, a.id)}>
                  <button type="submit" className="text-xs text-muted">
                    Dismiss
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Card id="preferences" className="scroll-mt-20 p-5">
        <SectionTitle>Alert preferences</SectionTitle>
        <ActionForm action={saveAlertPrefsAction} submitLabel="Save preferences">
          <fieldset>
            <legend className="label">Alert me about</legend>
            <div className="grid gap-1.5 text-sm sm:grid-cols-2">
              {ALERT_EVENT_TYPES.map((t) => (
                <label key={t} className="flex items-center gap-2">
                  <input type="checkbox" name="enabledTypes" value={t} defaultChecked={prefs.enabledTypes.includes(t)} /> {ALERT_EVENT_LABELS[t]}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="a-mincpp" className="label">
                Minimum ¢ per point
              </label>
              <input id="a-mincpp" name="minCpp" type="number" step={0.1} min={0} defaultValue={prefs.minCpp ?? ''} className="field" />
            </div>
            <div>
              <label htmlFor="a-maxpts" className="label">
                Maximum Chase points
              </label>
              <input id="a-maxpts" name="maxPoints" type="number" min={0} defaultValue={prefs.maxPoints ?? ''} className="field" />
            </div>
            <div>
              <label htmlFor="a-maxcash" className="label">
                Maximum cash (USD)
              </label>
              <input id="a-maxcash" name="maxCashUsd" type="number" min={0} defaultValue={prefs.maxCashUsd ?? ''} className="field" />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="a-dest" className="label">
                Only these destinations (comma separated, blank = anywhere)
              </label>
              <input id="a-dest" name="destinations" defaultValue={prefs.destinations.join(', ')} className="field" />
            </div>
            <div>
              <label htmlFor="a-hotel" className="label">
                Hotel categories
              </label>
              <input id="a-hotel" name="hotelCategories" defaultValue={prefs.hotelCategories.join(', ')} className="field" placeholder="Category 7, Category 8" />
            </div>
            <div>
              <label htmlFor="a-from" className="label">
                Travel from
              </label>
              <input id="a-from" name="travelFrom" type="date" defaultValue={prefs.travelFrom ?? ''} className="field" />
            </div>
            <div>
              <label htmlFor="a-to" className="label">
                Travel to
              </label>
              <input id="a-to" name="travelTo" type="date" defaultValue={prefs.travelTo ?? ''} className="field" />
            </div>
            <div>
              <label htmlFor="a-freq" className="label">
                Frequency
              </label>
              <select id="a-freq" name="frequency" defaultValue={prefs.frequency} className="field">
                <option value="instant">As they happen</option>
                <option value="daily">Daily digest (deadlines still immediate)</option>
              </select>
            </div>
            <div>
              <label htmlFor="a-qs" className="label">
                Quiet hours start
              </label>
              <input id="a-qs" name="quietHoursStart" type="time" defaultValue={prefs.quietHoursStart ?? ''} className="field" />
            </div>
            <div>
              <label htmlFor="a-qe" className="label">
                Quiet hours end
              </label>
              <input id="a-qe" name="quietHoursEnd" type="time" defaultValue={prefs.quietHoursEnd ?? ''} className="field" />
            </div>
          </div>
          <fieldset>
            <legend className="label">Cabins</legend>
            <div className="flex flex-wrap gap-3 text-sm">
              {CABINS.map((c) => (
                <label key={c} className="flex items-center gap-1.5">
                  <input type="checkbox" name="cabins" value={c} defaultChecked={prefs.cabins.includes(c)} /> {CABIN_LABELS[c]}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="label">Deadline reminders</legend>
            <div className="flex flex-wrap gap-3 text-sm">
              {REMINDER_OFFSETS.map((r) => (
                <label key={r.id} className="flex items-center gap-1.5">
                  <input type="checkbox" name="reminderOffsets" value={r.id} defaultChecked={(prefs.reminderOffsets ?? []).includes(r.id)} /> {r.label}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted">Reminders apply only to confirmed deadlines. Award space without a known deadline gets change alerts instead of a countdown.</p>
          </fieldset>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="urgentOnly" defaultChecked={prefs.urgentOnly} /> Only urgent alerts (deadlines and ending bonuses)
          </label>
        </ActionForm>
      </Card>
    </div>
  )
}
