import type { Metadata } from 'next'
import { cardCanTransfer, cardLabel, type CardType } from '@/lib/domain/constants'
import { listPartners, listPromotions } from '@/lib/data/transfers'
import { assessPromotion, effectiveRatio, formatRatio, isPromotionActive } from '@/lib/engine/transfer'
import { formatAge } from '@/lib/engine/status'
import { dateTime } from '@/lib/format'
import { getEvaluation } from '@/lib/server/loaders'
import { toPartnerDTO, toPromotionDTO } from '@/lib/view/transfer-dto'
import { deletePromotionAction, verifyPromotionAction } from '@/app/actions/transfer-actions'
import { Countdown } from '@/components/deal/countdown'
import { PartnerEditor } from '@/components/transfers/partner-editor'
import { PromotionForm } from '@/components/transfers/promotion-form'
import { TransferCalculator } from '@/components/transfers/transfer-calculator'
import { Badge, Card, ExternalLink, Notice, PageHeader, SectionTitle } from '@/components/ui'

export const metadata: Metadata = { title: 'Transfer Center' }

const VERIFICATION_LABEL = {
  official_verified: { label: 'Verified with Chase', tone: 'ok' },
  owner_verified: { label: 'Verified by you', tone: 'ok' },
  research_seed: { label: 'Research — verify', tone: 'warn' },
  stale: { label: 'Stale — re-verify', tone: 'danger' },
} as const

export default async function TransfersPage({ searchParams }: { searchParams: Promise<{ program?: string; points?: string }> }) {
  const sp = await searchParams
  const data = await getEvaluation()
  const now = data.ctx.now
  const tz = data.account.settings.timezone
  const card = data.account.wallet.cardType as CardType
  const [partners, promotions] = await Promise.all([listPartners(data.db), listPromotions(data.db)])
  const active = promotions.filter((p) => isPromotionActive(p, now))
  const upcoming = promotions.filter((p) => p.startsAt > now)
  const past = promotions.filter((p) => p.endsAt && p.endsAt < now)
  const partnerName = new Map(partners.map((p) => [p.id, `${p.programName} (${p.name})`]))
  const floor = data.account.settings.pointFloorCents
  const initialPoints = Number(sp.points)

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Transfer Center"
        title="Chase Ultimate Rewards partners"
        subtitle="Ratios differ by card and change over time. Nothing here is hard-coded as permanent — confirm in your Chase account, then mark a partner verified."
      />

      {!cardCanTransfer(card) ? (
        <Notice tone="danger" title={`${cardLabel(card)} cannot transfer points on its own`}>
          Combine your points into a Sapphire Preferred, Sapphire Reserve or Ink Business Preferred account first. Change your card in Settings if this is wrong.
        </Notice>
      ) : (
        <Notice tone="primary">
          Showing ratios for your <strong>{cardLabel(card)}</strong>. Transfers usually run in 1,000-point increments and are typically irreversible.
        </Notice>
      )}

      <Card className="p-5">
        <SectionTitle>Transfer calculator</SectionTitle>
        <TransferCalculator
          partners={partners.map(toPartnerDTO)}
          promotions={promotions.map(toPromotionDTO)}
          card={card}
          chaseBalance={data.account.wallet.chaseBalance}
          partnerBalances={data.account.wallet.partnerBalances}
          pointFloorCents={floor}
          minAcceptableCpp={data.account.settings.minAcceptableCpp}
          nowIso={now.toISOString()}
          initialProgram={sp.program}
          initialPoints={Number.isFinite(initialPoints) && initialPoints > 0 ? initialPoints : undefined}
        />
      </Card>

      <section>
        <SectionTitle aside={<Badge tone={active.length ? 'gold' : 'neutral'}>{active.length} active</Badge>}>Transfer bonuses</SectionTitle>
        {active.length === 0 && upcoming.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-sm text-muted">
            No active transfer bonuses recorded. Bonuses appear here when you add one you saw in your Chase account, or when a monitored announcement is confirmed.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {[...active, ...upcoming].map((p) => {
              const partner = partners.find((x) => x.id === p.partnerId)
              const ratio = partner ? effectiveRatio(partner, card) : { chase: 1, partner: 1 }
              const verdict = assessPromotion(p.bonusPercent, ratio, partner?.typicalValueCents ?? null, floor)
              const endingSoon = p.endsAt && p.endsAt.getTime() - now.getTime() < 7 * 86_400_000
              return (
                <li key={p.id}>
                  <Card className="h-full p-4">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone="gold">{p.bonusPercent}% bonus</Badge>
                      <Badge tone={p.verificationStatus === 'reported' ? 'warn' : 'ok'}>{p.verificationStatus === 'reported' ? 'Reported — verify on chase.com' : 'Verified'}</Badge>
                      {p.isTargeted && <Badge>Targeted</Badge>}
                      {p.startsAt > now && <Badge tone="primary">Upcoming</Badge>}
                      {endingSoon && <Badge tone="danger">Ending soon</Badge>}
                    </div>
                    <p className="mt-2 font-semibold">{partnerName.get(p.partnerId) ?? p.partnerId}</p>
                    <p className="text-sm text-muted">
                      {dateTime(p.startsAt, p.endsAtTimezone ?? tz)} → {p.endsAt ? dateTime(p.endsAt, p.endsAtTimezone ?? tz) : 'no end date recorded'}
                    </p>
                    {p.endsAt && p.endsAt > now && (
                      <p className="text-sm">
                        <Countdown targetIso={p.endsAt.toISOString()} nowMs={now.getTime()} />
                      </p>
                    )}
                    <p className="mt-2 text-sm">
                      <Badge tone={verdict.verdict === 'strong' ? 'ok' : verdict.verdict === 'useful' ? 'primary' : verdict.verdict === 'weak' ? 'warn' : 'danger'}>{verdict.verdict}</Badge> {verdict.explanation}
                    </p>
                    <p className="mt-1 text-xs text-muted">A bonus alone is not a reason to transfer. Only move points for a specific, confirmed award.</p>
                    {p.eligibility && <p className="mt-1 text-xs text-muted">Eligibility: {p.eligibility}</p>}
                    <div className="mt-2 flex flex-wrap gap-3 text-sm">
                      {p.sourceUrl && <ExternalLink href={p.sourceUrl}>Source</ExternalLink>}
                      {p.verificationStatus === 'reported' && (
                        <form action={verifyPromotionAction.bind(null, p.id)}>
                          <button type="submit" className="text-primary underline-offset-2 hover:underline">
                            I confirmed it on chase.com
                          </button>
                        </form>
                      )}
                      <form action={deletePromotionAction.bind(null, p.id)}>
                        <button type="submit" className="text-danger underline-offset-2 hover:underline">
                          Remove
                        </button>
                      </form>
                    </div>
                  </Card>
                </li>
              )
            })}
          </ul>
        )}
        <details className="mt-4 rounded-2xl border border-line bg-surface p-4">
          <summary className="cursor-pointer text-sm font-semibold">Add a transfer bonus you found</summary>
          <div className="mt-4">
            <PromotionForm partners={partners.filter((p) => p.active).map((p) => ({ id: p.id, label: `${p.programName} (${p.name})` }))} />
          </div>
        </details>
      </section>

      <section>
        <SectionTitle>Partners</SectionTitle>
        <ul className="space-y-2">
          {partners.map((p) => {
            const ratio = effectiveRatio(p, card)
            const promo = active.find((x) => x.partnerId === p.id)
            const v = VERIFICATION_LABEL[p.verificationStatus]
            return (
              <li key={p.id}>
                <details className="rounded-2xl border border-line bg-surface p-4">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="min-w-48 flex-1">
                      <span className="font-semibold">{p.programName}</span> <span className="text-sm text-muted">· {p.name}</span>
                      {!p.active && <Badge className="ml-2" tone="danger">Not a current partner</Badge>}
                    </span>
                    <span className="tabular text-sm">
                      {formatRatio(ratio)}
                      {(ratio.chase !== p.baseRatio.chase || ratio.partner !== p.baseRatio.partner) && <span className="text-faint"> (base {formatRatio(p.baseRatio)})</span>}
                    </span>
                    {promo && <Badge tone="gold">+{promo.bonusPercent}%</Badge>}
                    <Badge tone={v.tone}>{v.label}</Badge>
                  </summary>
                  <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                    <dt className="text-muted">Type</dt>
                    <dd>{p.type === 'airline' ? `Airline${p.alliance ? ` · ${p.alliance}` : ''}` : 'Hotel'}</dd>
                    <dt className="text-muted">Minimum / increment</dt>
                    <dd className="tabular">
                      {p.minTransfer.toLocaleString('en-US')} / {p.transferIncrement.toLocaleString('en-US')}
                    </dd>
                    <dt className="text-muted">Processing time</dt>
                    <dd>{p.processingTime}</dd>
                    {Object.keys(p.cardRatioOverrides).length > 0 && (
                      <>
                        <dt className="text-muted">Card-specific ratios</dt>
                        <dd>
                          {Object.entries(p.cardRatioOverrides)
                            .map(([c, r]) => `${cardLabel(c as CardType)} ${formatRatio(r!)}`)
                            .join(' · ')}
                        </dd>
                      </>
                    )}
                    {p.restrictions && (
                      <>
                        <dt className="text-muted">Restrictions</dt>
                        <dd>{p.restrictions}</dd>
                      </>
                    )}
                    {p.bookingLimitations && (
                      <>
                        <dt className="text-muted">Booking notes</dt>
                        <dd>{p.bookingLimitations}</dd>
                      </>
                    )}
                    <dt className="text-muted">How to transfer</dt>
                    <dd>{p.transferInstructions ?? '—'}</dd>
                    <dt className="text-muted">Last verified</dt>
                    <dd>{p.lastVerifiedAt ? `${dateTime(p.lastVerifiedAt, tz)} (${formatAge(p.lastVerifiedAt, now)})` : 'Never — compiled from public reporting on 2026-10-18'}</dd>
                    {p.typicalValueCents != null && (
                      <>
                        <dt className="text-muted">Your planning value</dt>
                        <dd>{p.typicalValueCents.toFixed(2)}¢ per point (editable estimate, not live data)</dd>
                      </>
                    )}
                    {p.notes && (
                      <>
                        <dt className="text-muted">Notes</dt>
                        <dd>{p.notes}</dd>
                      </>
                    )}
                    <dt className="text-muted">Links</dt>
                    <dd className="flex flex-wrap gap-3">
                      {p.programUrl && <ExternalLink href={p.programUrl}>Official site</ExternalLink>}
                      {p.sourceUrls.map((u, i) => (
                        <ExternalLink key={u} href={u}>
                          Source {i + 1}
                        </ExternalLink>
                      ))}
                    </dd>
                  </dl>
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm text-primary">Correct or verify this partner</summary>
                    <PartnerEditor partner={toPartnerDTO(p)} />
                  </details>
                </details>
              </li>
            )
          })}
        </ul>
      </section>

      {past.length > 0 && (
        <section>
          <SectionTitle>Past promotions</SectionTitle>
          <ul className="divide-y divide-line rounded-2xl border border-line bg-surface text-sm">
            {past.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span>
                  <strong>{p.bonusPercent}%</strong> to {partnerName.get(p.partnerId) ?? p.partnerId}
                  <span className="text-muted">
                    {' '}
                    · {dateTime(p.startsAt, p.endsAtTimezone ?? tz)} → {p.endsAt ? dateTime(p.endsAt, p.endsAtTimezone ?? tz) : '—'}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <Badge tone={p.verificationStatus === 'reported' ? 'warn' : 'ok'}>{p.verificationStatus === 'reported' ? 'Reported' : 'Verified'}</Badge>
                  {p.sourceUrl && <ExternalLink href={p.sourceUrl}>Source</ExternalLink>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
