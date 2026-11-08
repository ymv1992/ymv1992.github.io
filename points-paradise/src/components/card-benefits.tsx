import { BENEFITS_CHECKED, CARD_BENEFITS } from '@/lib/domain/card-benefits'
import { cardLabel, type CardType } from '@/lib/domain/constants'
import { FLIGHT_EARN } from '@/lib/domain/earning'
import { Badge, Card, SectionTitle } from './ui'

const checked = new Date(`${BENEFITS_CHECKED}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

/** The owner's card: what it earns, its credits and how its transfers differ, with when it was last checked. */
export function CardBenefitsCard({ card }: { card: CardType }) {
  const b = CARD_BENEFITS[card]
  return (
    <Card className="p-5">
      <SectionTitle aside={<span className="text-xs text-muted">Checked {checked}</span>}>{cardLabel(card)} benefits</SectionTitle>
      {b ? (
        <div className="grid gap-5 text-sm sm:grid-cols-2">
          <section>
            <h3 className="text-xs font-semibold tracking-wide text-faint uppercase">Earning</h3>
            <ul className="mt-1.5 space-y-1">
              {b.earning.map((e) => (
                <li key={e.what} className="flex gap-2">
                  <span className="tabular w-8 shrink-0 font-semibold">{e.rate}</span>
                  <span>
                    {e.what} {e.isNew && <Badge tone="gold">New</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3 className="text-xs font-semibold tracking-wide text-faint uppercase">Credits &amp; perks</h3>
            <ul className="mt-1.5 list-disc space-y-1 pl-4">
              {b.perks.map((p) => (
                <li key={p.what}>
                  {p.what} {p.isNew && <Badge tone="gold">New</Badge>}
                </li>
              ))}
            </ul>
            {b.transfers.length > 0 && (
              <>
                <h3 className="mt-4 text-xs font-semibold tracking-wide text-faint uppercase">Transfers</h3>
                <ul className="mt-1.5 list-disc space-y-1 pl-4">
                  {b.transfers.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </>
            )}
            {b.annualFeeUsd != null && <p className="mt-4 text-muted">Annual fee: ${b.annualFeeUsd}</p>}
          </section>
        </div>
      ) : (
        <p className="text-sm text-muted">
          A full list for this card isn&rsquo;t compiled yet. On flights it earns: {FLIGHT_EARN[card]?.note ?? 'unknown'}.
        </p>
      )}
      <p className="mt-4 text-xs text-muted">
        Checked against public reporting every week and updated here when Chase changes something. Confirm in your Chase account before relying on a benefit.
        {b && (
          <>
            {' '}
            Sources:{' '}
            {b.sources.map((s, i) => (
              <span key={s.url}>
                {i > 0 && ', '}
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  {s.label}
                </a>
              </span>
            ))}
            .
          </>
        )}
      </p>
    </Card>
  )
}
