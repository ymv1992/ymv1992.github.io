import type { DealCardData } from '@/lib/view/deal-view'
import { cpp, points, usd } from '@/lib/format'
import { SceneArt } from '../scene-art'
import { Badge, StatusBadge, cx } from '../ui'
import { Countdown } from './countdown'

/** Hero image: owner/provider photo when present, otherwise generated scene art. */
export function DealImage({ d, className }: { d: Pick<DealCardData, 'id' | 'imageUrl' | 'imageCredit' | 'tags' | 'kind' | 'city'>; className?: string }) {
  if (d.imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- external, owner-supplied URLs; next/image would need every host allow-listed.
      <img src={d.imageUrl} alt={`${d.city}`} className={cx('h-full w-full object-cover', className)} loading="lazy" referrerPolicy="no-referrer" />
    )
  }
  return <SceneArt seed={`${d.city}-${d.id}`} tags={d.tags} kind={d.kind} className={cx('h-full w-full', className)} />
}

const RISK_TONE = { low: 'ok', medium: 'primary', high: 'warn', unknown: 'neutral' } as const

/** Full deal card used in the swipe deck. Purely presentational. */
export function DealCard({ d, nowMs }: { d: DealCardData; nowMs: number }) {
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-card select-none" aria-label={`${d.title}, ${d.city}`}>
      <div className="relative h-[44%] min-h-44 shrink-0 overflow-hidden">
        <DealImage d={d} />
        <div className="absolute inset-0 bg-gradient-to-t from-navy/85 via-navy/20 to-transparent" />
        <div className="absolute top-3 right-3 left-3 flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {d.isDemo && <Badge tone="gold" className="bg-gold text-white dark:text-navy">DEMO · FICTIONAL</Badge>}
            {d.rank != null && <Badge className="bg-navy/70 text-white">#{d.rank} overall</Badge>}
          </div>
          {!d.isDemo && <StatusBadge status={d.status} className="bg-surface/90" />}
        </div>
        <div className="absolute right-4 bottom-3 left-4 text-white">
          <p className="text-xs tracking-[0.16em] text-white/80 uppercase">{d.categoryLabels.join(' · ') || d.kind}</p>
          <h2 className="font-display text-2xl leading-tight sm:text-3xl">
            {d.city}
            <span className="text-white/75">, {d.country}</span>
          </h2>
          <p className="truncate text-sm text-white/85">{d.provider}</p>
        </div>
        {d.imageCredit && <p className="absolute right-2 bottom-1 text-[9px] text-white/60">{d.imageCredit}</p>}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm text-muted">{d.productLine}</p>
          <p className="shrink-0 text-xs text-faint">{d.dates}</p>
        </div>

        <div className="grid grid-cols-3 gap-2 rounded-2xl bg-surface-2 p-3">
          <div>
            <div className="text-[10px] font-semibold tracking-wider text-faint uppercase">Chase pts</div>
            <div className="text-xl font-semibold">{points(d.chasePoints)}</div>
            {d.bonusLabel && <div className="text-[10px] text-gold">{d.bonusLabel}</div>}
          </div>
          <div>
            <div className="text-[10px] font-semibold tracking-wider text-faint uppercase">+ Cash</div>
            <div className="text-xl font-semibold">{usd(d.mandatoryCashUsd)}</div>
            <div className="text-[10px] text-faint">vs {usd(d.comparableCashUsd)} cash</div>
          </div>
          <div>
            <div className="text-[10px] font-semibold tracking-wider text-faint uppercase">Value</div>
            {d.cpp != null ? (
              <>
                <div className="text-xl font-semibold text-primary">{cpp(d.cpp)}</div>
                <div className="text-[10px] text-faint">per point · {d.confidence} confidence</div>
              </>
            ) : (
              <div className="text-xs leading-tight text-warn">Value cannot be reliably calculated</div>
            )}
          </div>
        </div>

        {d.warnings.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Valuation warnings">
            {d.warnings.map((w) => (
              <li key={w}>
                <Badge tone="warn">⚠ {w}</Badge>
              </li>
            ))}
          </ul>
        )}
        <p className="line-clamp-3 text-sm text-ink/90">{d.why}</p>

        <dl className="mt-auto grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
          <div>
            <dt className="text-faint">Last verified</dt>
            <dd className="font-medium">{d.lastVerified}</dd>
          </div>
          <div>
            <dt className="text-faint">Book by</dt>
            <dd className="font-medium">
              {d.deadlineAtIso ? <Countdown targetIso={d.deadlineAtIso} nowMs={nowMs} prefix="" /> : d.deadlineHeadline}
            </dd>
          </div>
          <div className="col-span-2">
            <dt className="sr-only">Availability risk</dt>
            <dd>
              <Badge tone={RISK_TONE[d.availabilityRisk.level]}>Availability risk: {d.availabilityRisk.label}</Badge>
            </dd>
          </div>
        </dl>
      </div>
    </article>
  )
}
