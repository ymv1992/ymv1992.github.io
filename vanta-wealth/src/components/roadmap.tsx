'use client'

import { useMemo, useState } from 'react'
import { saveGoalAction } from '@/app/actions'
import { MILESTONES } from '@/lib/domain/types'
import { feeDrag, freedomNumber, medianYearToReach, probabilityAtLeast, simulate, toRealDollars, type ScenarioEvents } from '@/lib/engine/projection'
import { compactUsd, pct, usd } from '@/lib/format'
import { LineChart } from './charts/line-chart'
import { ActionForm } from './forms'
import { Section, Stat, cx } from './ui'

interface Props {
  tracked: number
  reported: number | null
  monthly: number
  goalTarget: number
  goalDate: string | null
  birthYear: number | null
  assumptions: { meanReturnPct: number; volatilityPct: number; inflationPct: number; feePct: number }
}

const PRESETS = [
  { label: 'Cautious', mean: 5, vol: 12 },
  { label: 'Middle', mean: 7, vol: 16 },
  { label: 'Optimistic', mean: 9, vol: 19 },
]

function NumberField({ id, label, value, onChange, step = 1, min = 0, suffix }: { id: string; label: string; value: number; onChange: (n: number) => void; step?: number; min?: number; suffix?: string }) {
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
        {suffix && <span className="font-normal text-faint"> {suffix}</span>}
      </label>
      <input id={id} type="number" className="field num" value={Number.isFinite(value) ? value : ''} step={step} min={min} onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))} />
    </div>
  )
}

export function Roadmap(p: Props) {
  const thisYear = new Date().getFullYear()
  const [useReported, setUseReported] = useState(false)
  const [start, setStart] = useState(Math.round(p.tracked))
  const [monthly, setMonthly] = useState(p.monthly)
  const [years, setYears] = useState(30)
  const [mean, setMean] = useState(p.assumptions.meanReturnPct)
  const [vol, setVol] = useState(p.assumptions.volatilityPct)
  const [fee, setFee] = useState(p.assumptions.feePct)
  const [inflation, setInflation] = useState(p.assumptions.inflationPct)
  const [target, setTarget] = useState(p.goalTarget)
  const [goalYear, setGoalYear] = useState(p.goalDate ? Number(p.goalDate.slice(0, 4)) : thisYear + 15)
  const [real, setReal] = useState(false)
  // Scenario switches
  const [raiseOn, setRaiseOn] = useState(false)
  const [raiseYear, setRaiseYear] = useState(3)
  const [raiseTo, setRaiseTo] = useState(Math.max(1000, p.monthly * 2))
  const [pauseOn, setPauseOn] = useState(false)
  const [pauseYear, setPauseYear] = useState(2)
  const [pauseLen, setPauseLen] = useState(1)
  const [crashOn, setCrashOn] = useState(false)
  const [crashYear, setCrashYear] = useState(2)
  const [crashPct, setCrashPct] = useState(30)
  const [buyOn, setBuyOn] = useState(false)
  const [buyYear, setBuyYear] = useState(5)
  const [buyAmount, setBuyAmount] = useState(60000)
  const [spending, setSpending] = useState(60000)
  const [rate, setRate] = useState(4)

  const startValue = useReported && p.reported != null ? p.reported : start
  const horizon = Math.min(50, Math.max(1, Math.round(years)))
  const events: ScenarioEvents = useMemo(
    () => ({
      ...(raiseOn ? { contributionChange: { fromYear: raiseYear, monthly: raiseTo } } : {}),
      ...(pauseOn ? { pause: { fromYear: pauseYear, years: pauseLen } } : {}),
      ...(crashOn ? { crash: { year: crashYear, dropPct: crashPct } } : {}),
      ...(buyOn ? { withdrawal: { year: buyYear, amount: buyAmount } } : {}),
    }),
    [raiseOn, raiseYear, raiseTo, pauseOn, pauseYear, pauseLen, crashOn, crashYear, crashPct, buyOn, buyYear, buyAmount],
  )
  const base = useMemo(() => ({ start: startValue, monthly, years: horizon, meanReturnPct: mean, volatilityPct: vol, feePct: fee, runs: 5000 }), [startValue, monthly, horizon, mean, vol, fee])
  const sim = useMemo(() => simulate({ ...base, events }), [base, events])
  const alt = useMemo(() => simulate({ ...base, monthly: monthly === 1000 ? 500 : 1000 }), [base, monthly])
  const plain = useMemo(() => simulate(base), [base])

  const adj = (v: number, y: number) => (real ? toRealDollars(v, inflation, y) : v)
  const series = (arr: number[]) => arr.map((v, y) => adj(v, y))
  const goalYears = Math.min(horizon, Math.max(1, goalYear - thisYear))
  // In "today's dollars" mode the target is treated as a today's-dollar amount, so it is inflated to its future equivalent.
  const inflate = (y: number) => (real ? Math.pow(1 + inflation / 100, y) : 1)
  const targetAt = (y: number) => target * inflate(y)
  const prob = probabilityAtLeast(sim, goalYears, targetAt(goalYears))
  const end = sim.p50[horizon]!
  const put = sim.contributed[horizon]!
  const drag10 = feeDrag(startValue, monthly, mean, fee, 10)
  const drag20 = feeDrag(startValue, monthly, mean, fee, 20)
  const altMonthly = monthly === 1000 ? 500 : 1000
  const freedom = freedomNumber(spending, rate)
  const freedomYear = medianYearToReach(sim, freedom)
  const anyScenario = raiseOn || pauseOn || crashOn || buyOn

  return (
    <div className="space-y-6">
      <Section title="Starting point and assumptions" hint="Every figure below follows from these inputs. The return and volatility figures are assumptions you choose; nobody knows what markets will return.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <NumberField id="rm-start" label="Starting value ($)" value={startValue} onChange={(n) => { setUseReported(false); setStart(n) }} step={1000} />
            <p className="mt-1 text-[11px] text-faint">Tracked portfolio: {usd(p.tracked)}</p>
            {p.reported != null && p.reported !== p.tracked && (
              <label className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
                <input type="checkbox" checked={useReported} onChange={(e) => setUseReported(e.target.checked)} /> Use my self-reported total ({usd(p.reported)}, unverified)
              </label>
            )}
          </div>
          <NumberField id="rm-monthly" label="Monthly contribution ($)" value={monthly} onChange={setMonthly} step={50} />
          <NumberField id="rm-years" label="Years to project" value={years} onChange={setYears} min={1} />
          <NumberField id="rm-fee" label="Yearly fund fees (%)" value={fee} onChange={setFee} step={0.05} />
          <NumberField id="rm-mean" label="Average yearly return (%)" value={mean} onChange={setMean} step={0.5} min={-20} suffix="assumption" />
          <NumberField id="rm-vol" label="Yearly volatility (%)" value={vol} onChange={setVol} step={1} suffix="assumption" />
          <NumberField id="rm-infl" label="Inflation (%)" value={inflation} onChange={setInflation} step={0.25} suffix="assumption" />
          <div>
            <p className="label">Quick scenarios</p>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((s) => (
                <button key={s.label} type="button" onClick={() => { setMean(s.mean); setVol(s.vol) }} className={cx('rounded-full border px-3 py-1.5 text-xs', mean === s.mean && vol === s.vol ? 'border-transparent bg-gold-soft text-gold' : 'border-line text-muted hover:text-ink')}>
                  {s.label} {s.mean}%
                </button>
              ))}
            </div>
          </div>
        </div>
      </Section>

      <Section
        title="Range of outcomes"
        hint={`5,000 simulated paths. The shaded areas show where the middle 50% and middle 80% of paths fall${anyScenario ? ', with your what-if scenarios applied' : ''}.`}
        actions={
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={real} onChange={(e) => setReal(e.target.checked)} /> Show in today&apos;s dollars
          </label>
        }
      >
        <LineChart
          ariaLabel="Projected portfolio value by year: median path, range of simulated outcomes, and money contributed"
          xLabels={sim.p50.map((_, y) => String(thisYear + y))}
          bands={[
            { label: 'Middle 80% of paths', low: series(sim.p10), high: series(sim.p90), tone: 1 },
            { label: 'Middle 50% of paths', low: series(sim.p25), high: series(sim.p75), tone: 2 },
          ]}
          series={[
            { key: 'median', label: 'Median path', values: series(sim.p50), style: 'solid' },
            { key: 'put', label: 'Money you put in', values: series(sim.contributed), style: 'dashed' },
          ]}
          height={340}
        />
        <div className="mt-6 grid grid-cols-2 gap-6 lg:grid-cols-4">
          <Stat label={`Median in ${thisYear + horizon}`} value={compactUsd(adj(end, horizon))} sub={real ? "In today's dollars" : `${compactUsd(toRealDollars(end, inflation, horizon))} in today's dollars`} />
          <Stat label="Weaker 1-in-10 path" value={compactUsd(adj(sim.p10[horizon]!, horizon))} sub="10% of paths end below this" />
          <Stat label="Stronger 1-in-10 path" value={compactUsd(adj(sim.p90[horizon]!, horizon))} sub="10% of paths end above this" />
          <Stat label="From growth (median)" value={pct(end > 0 ? (Math.max(0, end - put) / end) * 100 : 0, 0)} sub={`${compactUsd(put)} put in, ${compactUsd(Math.max(0, end - put))} growth`} />
        </div>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Chance of reaching my goal" hint="Share of simulated paths at or above the target in the goal year. A model estimate, not a prediction.">
          <div className="grid grid-cols-2 gap-4">
            <NumberField id="rm-target" label="Target ($)" value={target} onChange={setTarget} step={50000} />
            <NumberField id="rm-goalyear" label="By the end of year" value={goalYear} onChange={setGoalYear} min={thisYear + 1} />
          </div>
          <p className="num mt-5 text-5xl text-ink">{pct(prob * 100, 0)}</p>
          <p className="mt-1 text-sm text-muted">
            of paths reach {usd(target)}
            {real ? " (today's dollars)" : ''} by {thisYear + goalYears}
            {p.birthYear ? `, when you are ${thisYear + goalYears - p.birthYear}` : ''}.{goalYear - thisYear > horizon ? ` Limited to your ${horizon}-year projection.` : ''}
          </p>
          <div className="mt-3 h-2 rounded-full bg-surface-2" role="img" aria-label={`${pct(prob * 100, 0)} of simulated paths reach the target`}>
            <div className="h-full rounded-full bg-gold" style={{ width: `${prob * 100}%` }} />
          </div>
          <div className="mt-5">
            <ActionForm action={saveGoalAction} submitLabel="Save these as my defaults" variant="secondary" className="space-y-0">
              {Object.entries({ meanReturnPct: mean, volatilityPct: vol, inflationPct: inflation, feePct: fee, goalTarget: target, goalDate: `${goalYear}-12-31`, monthlyContribution: monthly }).map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={String(v)} />
              ))}
            </ActionForm>
          </div>
        </Section>

        <Section title="Milestones" hint="Year the median path first reaches each milestone, and the chance of being there by the end of the projection.">
          <table className="w-full text-sm">
            <thead>
              <tr className="eyebrow border-b border-line text-right">
                <th className="py-2 text-left font-semibold">Milestone</th>
                <th className="py-2 font-semibold">Median year</th>
                <th className="py-2 font-semibold">Chance by {thisYear + horizon}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {MILESTONES.map((m) => {
                const y = sim.p50.findIndex((v, i) => v >= m * inflate(i))
                return (
                  <tr key={m} className="text-right">
                    <td className="num py-2.5 text-left text-ink">{usd(m)}</td>
                    <td className="num py-2.5">{startValue >= m ? 'Reached' : y < 0 ? `After ${thisYear + horizon}` : `${thisYear + y}${p.birthYear ? ` · age ${thisYear + y - p.birthYear}` : ''}`}</td>
                    <td className="num py-2.5">{pct(probabilityAtLeast(sim, horizon, m * inflate(horizon)) * 100, 0)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {real && <p className="mt-3 text-xs text-faint">Milestones are treated as today&apos;s-dollar amounts.</p>}
        </Section>
      </div>

      <Section title="What if…" hint="Switch on any combination. The chart, goal chance and milestones above update to include them.">
        <div className="grid gap-4 lg:grid-cols-2">
          {[
            { on: raiseOn, set: setRaiseOn, title: 'I change my monthly contribution later', body: (<><NumberField id="wi-ry" label="Starting in year" value={raiseYear} onChange={setRaiseYear} min={1} /><NumberField id="wi-rt" label="New monthly amount ($)" value={raiseTo} onChange={setRaiseTo} step={50} /></>) },
            { on: pauseOn, set: setPauseOn, title: 'I pause contributions (career break)', body: (<><NumberField id="wi-py" label="Starting in year" value={pauseYear} onChange={setPauseYear} min={1} /><NumberField id="wi-pl" label="For how many years" value={pauseLen} onChange={setPauseLen} min={1} /></>) },
            { on: crashOn, set: setCrashOn, title: 'The market drops sharply', body: (<><NumberField id="wi-cy" label="In year" value={crashYear} onChange={setCrashYear} min={1} /><NumberField id="wi-cp" label="Drop (%)" value={crashPct} onChange={setCrashPct} min={1} /></>) },
            { on: buyOn, set: setBuyOn, title: 'I take money out (property down payment, extra cash reserve)', body: (<><NumberField id="wi-by" label="In year" value={buyYear} onChange={setBuyYear} min={1} /><NumberField id="wi-ba" label="Amount ($)" value={buyAmount} onChange={setBuyAmount} step={5000} /></>) },
          ].map((w) => (
            <div key={w.title} className={cx('rounded-xl border p-4', w.on ? 'border-gold/50 bg-gold-soft/40' : 'border-line')}>
              <label className="flex items-center gap-2 text-sm font-medium text-ink">
                <input type="checkbox" checked={w.on} onChange={(e) => w.set(e.target.checked)} /> {w.title}
              </label>
              {w.on && <div className="mt-3 grid grid-cols-2 gap-3">{w.body}</div>}
            </div>
          ))}
        </div>
        {anyScenario && (
          <p className="mt-4 text-sm text-muted">
            Median in {thisYear + horizon}: <span className="num text-ink">{compactUsd(end)}</span> with these scenarios, against <span className="num text-ink">{compactUsd(plain.p50[horizon]!)}</span> without. Money taken out is not lost if it buys another asset; that asset just is not modelled here yet.
          </p>
        )}
      </Section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Section title={`${usd(monthly)} or ${usd(altMonthly)} a month`}>
          <div className="space-y-4">
            <Stat label={`${usd(monthly)}/month · median in ${thisYear + horizon}`} value={compactUsd(plain.p50[horizon]!)} />
            <Stat label={`${usd(altMonthly)}/month · median in ${thisYear + horizon}`} value={compactUsd(alt.p50[horizon]!)} sub={`Difference: ${compactUsd(Math.abs(alt.p50[horizon]! - plain.p50[horizon]!))}, from ${compactUsd(Math.abs(altMonthly - monthly) * 12 * horizon)} of extra contributions`} />
          </div>
        </Section>
        <Section title="What fees cost" hint={`A ${fee}% yearly fee at a steady ${mean}% return.`}>
          <div className="space-y-4">
            <Stat label="Over 10 years" value={usd(drag10.cost)} sub={`${compactUsd(drag10.withFee)} instead of ${compactUsd(drag10.withoutFee)}`} />
            <Stat label="Over 20 years" value={usd(drag20.cost)} sub={`${compactUsd(drag20.withFee)} instead of ${compactUsd(drag20.withoutFee)}`} />
          </div>
        </Section>
        <Section title="Financial freedom number">
          <div className="grid grid-cols-2 gap-3">
            <NumberField id="ff-spend" label="Yearly spending ($)" value={spending} onChange={setSpending} step={5000} />
            <NumberField id="ff-rate" label="Withdrawal rate (%)" value={rate} onChange={setRate} step={0.25} min={0.5} />
          </div>
          <p className="num mt-4 text-3xl text-ink">{Number.isFinite(freedom) ? usd(freedom) : '—'}</p>
          <p className="mt-1 text-sm text-muted">{freedomYear == null ? `The median path does not reach this within ${horizon} years.` : freedomYear === 0 ? 'Your starting value already covers this.' : `The median path reaches this around ${thisYear + freedomYear}.`}</p>
          <p className="mt-2 text-xs text-faint">Withdrawal rates near 4% come from historical US studies of 30-year retirements. Longer periods, taxes and other income change the answer; treat it as a rough marker.</p>
        </Section>
      </div>

      <p className="text-xs leading-relaxed text-faint">
        Method: each path draws monthly returns from a lognormal distribution with your average return (less fees) and volatility. Real markets have more extreme months than this model and bad years tend to cluster, so actual outcomes can fall outside the shaded range. Taxes on gains are not modelled.
      </p>
    </div>
  )
}
