'use client'

import { useMemo, useState } from 'react'
import { CHASE_TRAVEL_PROGRAM_ID, cardLabel, type CardType } from '@/lib/domain/constants'
import { quoteTransfer, transferAdvice, formatRatio } from '@/lib/engine/transfer'
import { computeCpp } from '@/lib/engine/valuation'
import { fromPartnerDTO, fromPromotionDTO, type PartnerDTO, type PromotionDTO } from '@/lib/view/transfer-dto'
import { cpp, points, usd } from '@/lib/format'
import { Badge, cx } from '../ui'

interface Props {
  partners: PartnerDTO[]
  promotions: PromotionDTO[]
  card: CardType
  chaseBalance: number
  partnerBalances: Record<string, number>
  pointFloorCents: number
  minAcceptableCpp: number
  nowIso: string
  initialProgram?: string
  initialPoints?: number
}

const VERDICT_TONE = { advisable_after_verifying: 'ok', marginal: 'warn', not_advisable: 'danger', insufficient_info: 'neutral' } as const

export function TransferCalculator(p: Props) {
  const active = p.partners.filter((x) => x.active)
  const [programId, setProgramId] = useState(p.initialProgram && active.some((a) => a.id === p.initialProgram) ? p.initialProgram : (active[0]?.id ?? ''))
  const [needed, setNeeded] = useState(p.initialPoints ? String(p.initialPoints) : '60000')
  const [balance, setBalance] = useState(String(p.chaseBalance))
  const [existing, setExisting] = useState(String(p.partnerBalances[programId] ?? 0))
  const [manualBonus, setManualBonus] = useState('')
  const [taxes, setTaxes] = useState('')
  const [cash, setCash] = useState('')
  const [confirmed, setConfirmed] = useState(false)

  const partnersMap = useMemo(() => new Map(p.partners.map((x) => [x.id, fromPartnerDTO(x)])), [p.partners])
  const promos = useMemo(() => p.promotions.map(fromPromotionDTO), [p.promotions])
  const now = useMemo(() => new Date(p.nowIso), [p.nowIso])

  const num = (s: string) => (s.trim() === '' ? null : Number(s))
  const neededN = num(needed)
  const quote =
    neededN && neededN > 0 && programId
      ? quoteTransfer({
          programId,
          programPoints: neededN,
          partners: partnersMap,
          promotions: promos,
          card: p.card,
          at: now,
          existingPartnerBalance: num(existing) ?? 0,
          manualBonusPercent: num(manualBonus),
        })
      : null
  const taxesN = num(taxes)
  const cashN = num(cash)
  // Value is measured on the full award, regardless of miles already in the partner account.
  const fullQuote =
    quote && neededN
      ? quoteTransfer({ programId, programPoints: neededN, partners: partnersMap, promotions: promos, card: p.card, at: now, manualBonusPercent: num(manualBonus) })
      : null
  const value = fullQuote ? computeCpp(cashN, taxesN, fullQuote.requirement.chasePoints) : null
  const advice = quote
    ? transferAdvice({
        quote,
        chaseBalance: num(balance) ?? 0,
        cpp: value,
        pointFloorCents: p.pointFloorCents,
        minAcceptableCpp: p.minAcceptableCpp,
        availabilityConfirmed: confirmed,
      })
    : null
  const partner = partnersMap.get(programId)

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form className="grid grid-cols-2 gap-3" onSubmit={(e) => e.preventDefault()} aria-label="Transfer calculator inputs">
        <div className="col-span-2">
          <label htmlFor="calc-program" className="label">
            Award program
          </label>
          <select
            id="calc-program"
            className="field"
            value={programId}
            onChange={(e) => {
              setProgramId(e.target.value)
              setExisting(String(p.partnerBalances[e.target.value] ?? 0))
            }}
          >
            {active.map((x) => (
              <option key={x.id} value={x.id}>
                {x.programName} ({x.name})
              </option>
            ))}
            <option value={CHASE_TRAVEL_PROGRAM_ID}>Chase Travel (pay with points)</option>
          </select>
        </div>
        <div>
          <label htmlFor="calc-needed" className="label">
            Partner points needed
          </label>
          <input id="calc-needed" type="number" inputMode="numeric" min={0} className="field tabular" value={needed} onChange={(e) => setNeeded(e.target.value)} />
        </div>
        <div>
          <label htmlFor="calc-existing" className="label">
            Already in partner account
          </label>
          <input id="calc-existing" type="number" inputMode="numeric" min={0} className="field tabular" value={existing} onChange={(e) => setExisting(e.target.value)} />
        </div>
        <div>
          <label htmlFor="calc-balance" className="label">
            Your Chase balance
          </label>
          <input id="calc-balance" type="number" inputMode="numeric" min={0} className="field tabular" value={balance} onChange={(e) => setBalance(e.target.value)} />
        </div>
        <div>
          <label htmlFor="calc-bonus" className="label">
            Bonus % (blank = active promo)
          </label>
          <input id="calc-bonus" type="number" min={0} max={300} className="field tabular" placeholder={quote?.promotion ? String(quote.promotion.bonusPercent) : '0'} value={manualBonus} onChange={(e) => setManualBonus(e.target.value)} />
        </div>
        <div>
          <label htmlFor="calc-taxes" className="label">
            Taxes &amp; fees (USD)
          </label>
          <input id="calc-taxes" type="number" min={0} className="field tabular" value={taxes} onChange={(e) => setTaxes(e.target.value)} />
        </div>
        <div>
          <label htmlFor="calc-cash" className="label">
            Comparable cash price (USD)
          </label>
          <input id="calc-cash" type="number" min={0} className="field tabular" value={cash} onChange={(e) => setCash(e.target.value)} />
        </div>
        <label className="col-span-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          I have confirmed award availability on the partner&apos;s site
        </label>
      </form>

      <div aria-live="polite" className="rounded-2xl bg-surface-2 p-4">
        {!quote ? (
          <p className="text-sm text-muted">Enter the partner points an award needs.</p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[11px] font-semibold text-faint uppercase">Chase points to transfer</div>
                <div className="text-3xl font-semibold">{points(quote.requirement.chasePoints)}</div>
              </div>
              <div>
                <div className="text-[11px] font-semibold text-faint uppercase">Value per point</div>
                <div className="text-3xl font-semibold text-primary">{value != null ? cpp(value) : '—'}</div>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              {!quote.isChaseTravel && (
                <>
                  <dt className="text-muted">Ratio ({cardLabel(p.card)})</dt>
                  <dd className="tabular text-right">{quote.ratio ? formatRatio(quote.ratio) : '—'}</dd>
                  <dt className="text-muted">Bonus</dt>
                  <dd className="tabular text-right">{quote.bonusPercent ? `${quote.bonusPercent}%${quote.promotion ? ' (active promo)' : ' (entered)'}` : 'None'}</dd>
                  <dt className="text-muted">Partner points received</dt>
                  <dd className="tabular text-right">{points(quote.requirement.partnerReceived)}</dd>
                  <dt className="text-muted">…of which bonus</dt>
                  <dd className="tabular text-right">{points(quote.requirement.bonusPartnerPoints)}</dd>
                  <dt className="text-muted">Left over after booking</dt>
                  <dd className="tabular text-right">{points(quote.requirement.surplusPartnerPoints)}</dd>
                  <dt className="text-muted">Increment / minimum</dt>
                  <dd className="tabular text-right">{partner ? `${points(partner.transferIncrement)} / ${points(partner.minTransfer)}` : '—'}</dd>
                  <dt className="text-muted">Processing</dt>
                  <dd className="text-right">{quote.processingTime}</dd>
                </>
              )}
              <dt className="text-muted">Chase points remaining</dt>
              <dd className={cx('tabular text-right', (num(balance) ?? 0) < quote.requirement.chasePoints && 'text-danger')}>{points((num(balance) ?? 0) - quote.requirement.chasePoints)}</dd>
              <dt className="text-muted">Taxes &amp; fees</dt>
              <dd className="tabular text-right">{usd(taxesN)}</dd>
            </dl>
            {advice && (
              <div className="rounded-xl bg-surface p-3">
                <Badge tone={VERDICT_TONE[advice.verdict]}>{advice.label}</Badge>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
                  {advice.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
            {quote.warnings.map((w) => (
              <p key={w} className="text-xs text-warn">
                ⚠ {w}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
