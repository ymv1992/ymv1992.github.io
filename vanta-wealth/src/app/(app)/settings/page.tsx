import type { Metadata } from 'next'
import { deleteAllDataAction, saveProfileAction } from '../../actions'
import { listAudit } from '@/lib/data/store'
import { RISK_PROFILES } from '@/lib/domain/types'
import { dateTime } from '@/lib/format'
import { integrationStatus } from '@/lib/server/config'
import { loadPage } from '@/lib/server/load'
import { ActionForm } from '@/components/forms'
import { Badge, PageHeader, Section, buttonClass } from '@/components/ui'

export const metadata: Metadata = { title: 'Settings' }

const RISK_TEXT: Record<(typeof RISK_PROFILES)[number], string> = {
  conservative: 'Conservative — protecting what I have matters most; I accept slower growth.',
  balanced: 'Balanced — a mix of growth and stability; large drops would bother me.',
  growth: 'Growth — mostly stocks; I can sit through a 30% drop without selling.',
  aggressive: 'Aggressive — I accept very large swings, including 50%+ drops, for higher potential growth.',
}

function Status({ on, labelOn = 'Connected', labelOff = 'Not connected' }: { on: boolean; labelOn?: string; labelOff?: string }) {
  return <Badge tone={on ? 'ok' : 'warn'}>{on ? `✓ ${labelOn}` : labelOff}</Badge>
}

export default async function SettingsPage() {
  const { db, userId, overview: o, feeds } = await loadPage()
  const st = integrationStatus()
  const log = await listAudit(db, userId, 25)
  const p = o.profile
  return (
    <>
      <PageHeader title="Settings" subtitle="Your profile, data connections and privacy controls." />
      <div className="space-y-6">
        <Section title="Investor profile" hint="Every figure is yours to edit. Income is recorded for context only and is never assumed to be available to invest.">
          <ActionForm action={saveProfileAction} submitLabel="Save profile">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className="label" htmlFor="monthlyContribution">Planned monthly investment ($)</label>
                <input id="monthlyContribution" name="monthlyContribution" className="field num" inputMode="decimal" defaultValue={p.monthlyContribution ?? ''} />
              </div>
              <div>
                <label className="label" htmlFor="monthlyIncome">Monthly income ($)</label>
                <input id="monthlyIncome" name="monthlyIncome" className="field num" inputMode="decimal" defaultValue={p.monthlyIncome ?? ''} />
              </div>
              <div>
                <label className="label" htmlFor="birthYear">Birth year (for “by age” projections)</label>
                <input id="birthYear" name="birthYear" className="field num" inputMode="numeric" defaultValue={p.birthYear ?? ''} />
              </div>
              <div>
                <label className="label" htmlFor="reportedPortfolio">Self-reported total investments ($)</label>
                <input id="reportedPortfolio" name="reportedPortfolio" className="field num" inputMode="decimal" defaultValue={p.reportedPortfolio ?? ''} />
                <p className="mt-1 text-[11px] text-faint">An unverified estimate, shown for comparison only. It is never added to tracked holdings.</p>
              </div>
              <div>
                <label className="label" htmlFor="reportedPortfolioAsOf">Estimate as of</label>
                <input id="reportedPortfolioAsOf" name="reportedPortfolioAsOf" type="date" className="field num" defaultValue={p.reportedPortfolioAsOf ?? ''} />
              </div>
            </div>
            <fieldset>
              <legend className="label">Risk profile — choose the one that fits; none is assumed from what you invest in</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {RISK_PROFILES.map((r) => (
                  <label key={r} className="flex items-start gap-2 rounded-xl border border-line p-3 text-sm text-ink has-[:checked]:border-gold/60 has-[:checked]:bg-gold-soft/40">
                    <input type="radio" name="riskProfile" value={r} defaultChecked={p.riskProfile === r} className="mt-1" />
                    {RISK_TEXT[r]}
                  </label>
                ))}
                <label className="flex items-start gap-2 rounded-xl border border-line p-3 text-sm text-muted">
                  <input type="radio" name="riskProfile" value="" defaultChecked={!p.riskProfile} className="mt-1" />
                  Not decided yet
                </label>
              </div>
            </fieldset>
          </ActionForm>
        </Section>

        <Section id="data" title="Data connections" hint="Keys are stored in your hosting settings on the server and are never sent to your browser. No connection is simulated: anything not connected shows as blank.">
          <ul className="divide-y divide-line">
            <li className="py-4 first:pt-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-ink">Stock and fund prices, company news, earnings dates — Finnhub (free plan)</p>
                <Status on={st.finnhub} />
              </div>
              {!st.finnhub && (
                <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-muted">
                  <li>Go to finnhub.io and choose “Get free API key”. Sign up with an email address; no card is needed.</li>
                  <li>After signing in, your key is shown on the dashboard. Copy it.</li>
                  <li>Open your project in Vercel, then Settings → Environment Variables.</li>
                  <li>Add a variable named <code className="num text-xs text-ink">FINNHUB_API_KEY</code>, paste the key as its value, and save.</li>
                  <li>Open Deployments, choose the latest one, and select Redeploy. Prices appear on the next page load.</li>
                </ol>
              )}
              {feeds.get('quotes:stocks')?.error && <p className="mt-2 text-sm text-warn">Last attempt: {feeds.get('quotes:stocks')!.error}</p>}
            </li>
            <li className="py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-ink">Crypto prices — CoinGecko public feed</p>
                <Status on={!feeds.get('quotes:crypto')?.error} labelOn={st.coingeckoKey ? 'Connected with key' : 'No key needed'} labelOff="Last request failed" />
              </div>
              <p className="mt-2 text-sm text-muted">
                Works without a key at a low request limit. If prices fail often, create a free demo key at coingecko.com and add it as <code className="num text-xs text-ink">COINGECKO_API_KEY</code>.
              </p>
              {feeds.get('quotes:crypto')?.error && <p className="mt-2 text-sm text-warn">Last attempt: {feeds.get('quotes:crypto')!.error}</p>}
            </li>
            <li className="py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-ink">Daily value recording</p>
                <Status on={st.cron} labelOn="Scheduled" labelOff="Records only when you open the app" />
              </div>
              <p className="mt-2 text-sm text-muted">
                With <code className="num text-xs text-ink">CRON_SECRET</code> set, your portfolio value is recorded once a day even when you do not sign in.
              </p>
            </li>
            <li className="py-4 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-ink">Brokerage and exchange accounts</p>
                <Badge>Manual entry and CSV for now</Badge>
              </div>
              <p className="mt-2 text-sm text-muted">This app never asks for a brokerage password. Read-only account linking is a planned module and will only use connections the provider officially supports.</p>
            </li>
          </ul>
          <p className="mt-4 text-xs text-faint">Database: {st.database === 'postgres' ? 'hosted Postgres' : 'local development database'}.</p>
        </Section>

        <Section title="Your data" hint="Export everything as a file, or delete it.">
          <a href="/api/export" className={buttonClass('secondary')}>
            Download all my data (JSON)
          </a>
          <div className="mt-6 rounded-xl border border-danger/30 p-4">
            <p className="text-sm font-medium text-ink">Delete all portfolio data</p>
            <p className="mt-1 text-sm text-muted">Removes holdings, other assets, journal, watchlist, notes and recorded history. This cannot be undone. Your sign-in stays.</p>
            <div className="mt-3">
              <ActionForm action={deleteAllDataAction} submitLabel="Delete everything" variant="secondary" className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="label" htmlFor="confirm">Type DELETE to confirm</label>
                  <input id="confirm" name="confirm" className="field num w-40" autoComplete="off" />
                </div>
              </ActionForm>
            </div>
          </div>
        </Section>

        <Section title="Activity log" hint="The most recent changes made to your records.">
          {log.length === 0 ? (
            <p className="text-sm text-muted">No changes recorded yet.</p>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {log.map((l) => (
                <li key={l.id} className="flex flex-wrap gap-x-3 text-muted">
                  <span className="num text-faint">{dateTime(l.createdAt)}</span>
                  <span className="num text-ink">{l.action}</span>
                  <span>{l.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  )
}
