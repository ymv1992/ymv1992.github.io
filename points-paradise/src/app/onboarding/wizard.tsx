'use client'

import { useState, useTransition } from 'react'
import {
  CARD_TYPES,
  CATEGORY_DEFS,
  DATE_FLEXIBILITY,
  DATE_FLEXIBILITY_LABELS,
  TAG_LABELS,
  TRAVEL_TAGS,
  type CardType,
  type DateFlexibility,
} from '@/lib/domain/constants'
import { Button, Badge, cx } from '@/components/ui'
import { completeOnboarding, type OnboardingInput } from './actions'

interface Initial {
  cardType: CardType
  chaseBalance: number
  homeAirports: string[]
  maxCashUsd: number
  tagPreferences: Record<string, -1 | 0 | 1 | 2>
  tripStyles: string[]
  dateFlexibility: DateFlexibility
  preferredCategories: string[]
  dreamDestinations: string[]
  demoMode: boolean
}

const STEPS = ['Welcome', 'Card', 'Points', 'Airports', 'Cash budget', 'Travel style', 'Flexibility', 'Deal types', 'How evidence works'] as const
const PREF_LABEL: Record<number, string> = { [-1]: 'Avoid', 0: 'Neutral', 1: 'Like', 2: 'Love' }
const PREF_CYCLE: Record<number, -1 | 0 | 1 | 2> = { 0: 1, 1: 2, 2: -1, [-1]: 0 }
const TRIP_STYLES = ['solo', 'romantic', 'family', 'adventure', 'weekend', 'longer vacations', 'luxury'] as const

export function OnboardingWizard({ initial }: { initial: Initial }) {
  const [step, setStep] = useState(0)
  const [v, setV] = useState(initial)
  const [airportDraft, setAirportDraft] = useState('')
  const [dreamDraft, setDreamDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const last = step === STEPS.length - 1

  function finish() {
    setError(null)
    const payload: OnboardingInput = {
      ...v,
      tagPreferences: v.tagPreferences as OnboardingInput['tagPreferences'],
      preferredCategories: v.preferredCategories as OnboardingInput['preferredCategories'],
    }
    start(async () => {
      const res = await completeOnboarding(payload)
      if (res?.error) setError(res.error)
    })
  }

  function addAirport() {
    const code = airportDraft.trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(code)) {
      setError('Airport codes are three letters, e.g. LAX.')
      return
    }
    setError(null)
    if (!v.homeAirports.includes(code)) setV({ ...v, homeAirports: [...v.homeAirports, code] })
    setAirportDraft('')
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-8 flex items-center justify-between">
        <span className="font-display text-lg">Points &amp; Paradise</span>
        <span className="text-xs text-muted" aria-live="polite">
          Step {step + 1} of {STEPS.length}
        </span>
      </div>
      <div className="mb-8 h-1 w-full overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <div className="h-full bg-primary transition-all" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
      </div>

      <section className="animate-in flex-1" key={step} aria-labelledby="step-title">
        {step === 0 && (
          <div>
            <p className="text-xs font-semibold tracking-[0.2em] text-gold uppercase">Welcome</p>
            <h1 id="step-title" className="font-display mt-2 text-4xl leading-tight">
              Let&apos;s find what your Chase points can really unlock.
            </h1>
            <p className="mt-4 text-muted">
              A few quick questions tailor rankings and alerts. Every answer has a sensible default and you can change all of it later in Settings.
            </p>
          </div>
        )}
        {step === 1 && (
          <fieldset>
            <legend id="step-title" className="font-display text-3xl">
              Which Chase card earns your points?
            </legend>
            <p className="mt-2 text-sm text-muted">Transfer ratios and eligibility differ by card — some cards cannot transfer to partners at all.</p>
            <div className="mt-6 grid gap-2">
              {CARD_TYPES.map((c) => (
                <label key={c.id} className={cx('flex cursor-pointer items-center justify-between rounded-xl border px-4 py-3', v.cardType === c.id ? 'border-primary bg-primary-soft' : 'border-line bg-surface')}>
                  <span className="flex items-center gap-3">
                    <input type="radio" name="card" value={c.id} checked={v.cardType === c.id} onChange={() => setV({ ...v, cardType: c.id })} />
                    {c.label}
                  </span>
                  {!c.canTransfer && <Badge tone="warn">No direct transfers</Badge>}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {step === 2 && (
          <div>
            <h1 id="step-title" className="font-display text-3xl">
              How many Ultimate Rewards points do you have?
            </h1>
            <label htmlFor="balance" className="label mt-6">
              Chase points balance
            </label>
            <input
              id="balance"
              type="number"
              inputMode="numeric"
              min={0}
              step={1000}
              className="field tabular text-2xl"
              value={v.chaseBalance}
              onChange={(e) => setV({ ...v, chaseBalance: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
            />
            <p className="mt-2 text-xs text-muted">Stored only in your private database. Never your Chase login.</p>
          </div>
        )}
        {step === 3 && (
          <div>
            <h1 id="step-title" className="font-display text-3xl">
              Where do you usually fly from?
            </h1>
            <p className="mt-2 text-sm text-muted">We&apos;ll also look for positioning flights from other airports when they save real money.</p>
            <ul className="mt-6 flex flex-wrap gap-2" aria-label="Home airports">
              {v.homeAirports.map((a) => (
                <li key={a}>
                  <button
                    type="button"
                    onClick={() => setV({ ...v, homeAirports: v.homeAirports.filter((x) => x !== a) })}
                    className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-semibold"
                    aria-label={`Remove ${a}`}
                  >
                    {a} <span aria-hidden className="text-faint">×</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex gap-2">
              <label htmlFor="airport" className="sr-only">
                Add an airport code
              </label>
              <input
                id="airport"
                className="field max-w-[10rem] uppercase"
                maxLength={3}
                placeholder="e.g. LGB"
                value={airportDraft}
                onChange={(e) => setAirportDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addAirport()
                  }
                }}
              />
              <Button type="button" variant="secondary" onClick={addAirport}>
                Add
              </Button>
            </div>
          </div>
        )}
        {step === 4 && (
          <div>
            <h1 id="step-title" className="font-display text-3xl">
              How much cash are you comfortable adding?
            </h1>
            <p className="mt-2 text-sm text-muted">Taxes, fees, resort fees and transfers on top of your points, per trip.</p>
            <label htmlFor="cash" className="label mt-6">
              Maximum additional cash (USD)
            </label>
            <input
              id="cash"
              type="number"
              inputMode="numeric"
              min={0}
              step={50}
              className="field tabular text-2xl"
              value={v.maxCashUsd}
              onChange={(e) => setV({ ...v, maxCashUsd: Math.max(0, Number(e.target.value) || 0) })}
            />
          </div>
        )}
        {step === 5 && (
          <div>
            <h1 id="step-title" className="font-display text-3xl">
              What makes a trip unforgettable for you?
            </h1>
            <p className="mt-2 text-sm text-muted">Tap to cycle: Neutral → Like → Love → Avoid. This shapes &ldquo;For You&rdquo;, not the value rankings.</p>
            <div className="mt-6 flex flex-wrap gap-2">
              {TRAVEL_TAGS.map((t) => {
                const pref = v.tagPreferences[t] ?? 0
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setV({ ...v, tagPreferences: { ...v.tagPreferences, [t]: PREF_CYCLE[pref]! } })}
                    aria-label={`${TAG_LABELS[t]}: ${PREF_LABEL[pref]}`}
                    className={cx(
                      'rounded-full border px-3 py-1.5 text-sm',
                      pref === 2 && 'border-gold bg-gold-soft font-semibold text-gold',
                      pref === 1 && 'border-primary bg-primary-soft text-primary',
                      pref === -1 && 'border-danger/40 bg-danger-soft text-danger line-through',
                      pref === 0 && 'border-line bg-surface text-muted',
                    )}
                  >
                    {TAG_LABELS[t]}
                    {pref !== 0 && <span className="ml-1 text-[10px] uppercase">{PREF_LABEL[pref]}</span>}
                  </button>
                )
              })}
            </div>
            <p className="label mt-6">Trip styles</p>
            <div className="flex flex-wrap gap-2">
              {TRIP_STYLES.map((s) => {
                const on = v.tripStyles.includes(s)
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setV({ ...v, tripStyles: on ? v.tripStyles.filter((x) => x !== s) : [...v.tripStyles, s] })}
                    className={cx('rounded-full border px-3 py-1.5 text-sm capitalize', on ? 'border-primary bg-primary-soft text-primary' : 'border-line bg-surface text-muted')}
                  >
                    {s}
                  </button>
                )
              })}
            </div>
            <label htmlFor="dream" className="label mt-6">
              Dream destinations (optional)
            </label>
            <div className="flex gap-2">
              <input
                id="dream"
                className="field"
                placeholder="e.g. Maldives, Kyoto, Patagonia"
                value={dreamDraft}
                onChange={(e) => setDreamDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && dreamDraft.trim()) {
                    e.preventDefault()
                    setV({ ...v, dreamDestinations: [...new Set([...v.dreamDestinations, ...dreamDraft.split(',').map((s) => s.trim()).filter(Boolean)])] })
                    setDreamDraft('')
                  }
                }}
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  if (!dreamDraft.trim()) return
                  setV({ ...v, dreamDestinations: [...new Set([...v.dreamDestinations, ...dreamDraft.split(',').map((s) => s.trim()).filter(Boolean)])] })
                  setDreamDraft('')
                }}
              >
                Add
              </Button>
            </div>
            {v.dreamDestinations.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2">
                {v.dreamDestinations.map((d) => (
                  <li key={d}>
                    <button
                      type="button"
                      className="rounded-full bg-gold-soft px-3 py-1 text-sm text-gold"
                      onClick={() => setV({ ...v, dreamDestinations: v.dreamDestinations.filter((x) => x !== d) })}
                      aria-label={`Remove ${d}`}
                    >
                      {d} ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {step === 6 && (
          <fieldset>
            <legend id="step-title" className="font-display text-3xl">
              How flexible are your dates?
            </legend>
            <div className="mt-6 grid gap-2">
              {DATE_FLEXIBILITY.map((f) => (
                <label key={f} className={cx('flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3', v.dateFlexibility === f ? 'border-primary bg-primary-soft' : 'border-line bg-surface')}>
                  <input type="radio" name="flex" checked={v.dateFlexibility === f} onChange={() => setV({ ...v, dateFlexibility: f })} />
                  {DATE_FLEXIBILITY_LABELS[f]}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {step === 7 && (
          <div>
            <h1 id="step-title" className="font-display text-3xl">
              Which deals excite you most?
            </h1>
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              {CATEGORY_DEFS.map((c) => {
                const on = v.preferredCategories.includes(c.slug)
                return (
                  <button
                    key={c.slug}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setV({ ...v, preferredCategories: on ? v.preferredCategories.filter((x) => x !== c.slug) : [...v.preferredCategories, c.slug] })}
                    className={cx('rounded-xl border px-4 py-3 text-left', on ? 'border-primary bg-primary-soft' : 'border-line bg-surface')}
                  >
                    <span className="block text-sm font-semibold">{c.label}</span>
                    <span className="block text-xs text-muted">{c.description}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
        {step === 8 && (
          <div>
            <h1 id="step-title" className="font-display text-3xl">
              Verified vs. unverified — the most important idea here
            </h1>
            <ul className="mt-6 space-y-3 text-sm">
              <li className="rounded-xl border border-line bg-surface p-4">
                <Badge tone="ok">Verified live</Badge> <Badge tone="primary">Recently verified</Badge>
                <p className="mt-2 text-muted">Confirmed by a data provider or by you on the official site within the last 6 / 72 hours. Only these are ranked as bookable.</p>
              </li>
              <li className="rounded-xl border border-line bg-surface p-4">
                <Badge tone="warn">Cached result</Badge> <Badge>Unverified lead</Badge>
                <p className="mt-2 text-muted">Older checks, announcements and research. Useful leads — but always re-check before transferring points.</p>
              </li>
              <li className="rounded-xl border border-line bg-surface p-4">
                <Badge>Prediction</Badge>
                <p className="mt-2 text-muted">Statistical patterns from your history. Never shown as a confirmed opportunity, and only when there is enough data.</p>
              </li>
              <li className="rounded-xl border border-line bg-surface p-4">
                <Badge tone="gold">Demo — fictional</Badge>
                <p className="mt-2 text-muted">Sample deals with invented airlines and hotels so you can explore the app before connecting data sources.</p>
                <label className="mt-3 flex items-center gap-2 font-medium">
                  <input type="checkbox" checked={v.demoMode} onChange={(e) => setV({ ...v, demoMode: e.target.checked })} />
                  Show demo data while I get set up
                </label>
              </li>
            </ul>
            <p className="mt-4 text-xs text-muted">This app never transfers points, books travel or asks for loyalty-program passwords.</p>
          </div>
        )}
      </section>

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-10 flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0 || pending}>
          Back
        </Button>
        <div className="flex gap-2">
          {!last && step > 0 && (
            <Button type="button" variant="ghost" onClick={() => setStep(step + 1)}>
              Skip
            </Button>
          )}
          {last ? (
            <Button type="button" size="lg" onClick={finish} disabled={pending}>
              {pending ? 'Setting up…' : 'Open my Discover feed'}
            </Button>
          ) : (
            <Button type="button" size="lg" onClick={() => setStep(step + 1)}>
              {step === 0 ? 'Get started' : 'Continue'}
            </Button>
          )}
        </div>
      </div>
      {step === 0 && (
        <button type="button" onClick={finish} className="mt-4 self-center text-sm text-muted underline underline-offset-2" disabled={pending}>
          Skip setup and use the defaults
        </button>
      )}
    </div>
  )
}
