'use client'

import { useActionState, useEffect, useId, useState, type ReactNode } from 'react'
import { saveDealAction, type DealFormState } from '@/app/actions/deal-form-actions'
import {
  AVAILABILITY,
  CABINS,
  CABIN_LABELS,
  CASH_SOURCES,
  CASH_SOURCE_LABELS,
  DEAL_KINDS,
  ROOM_TYPES,
  ROOM_TYPE_LABELS,
  SEAT_TYPES,
  SEAT_TYPE_LABELS,
  TAG_LABELS,
  TRAVEL_TAGS,
} from '@/lib/domain/constants'
import { Button, Card, cx } from '../ui'

interface Program {
  id: string
  label: string
}

function Field({ name, label, errors, children, hint, className }: { name: string; label: string; errors?: Record<string, string>; children: ReactNode; hint?: string; className?: string }) {
  const err = errors?.[name]
  return (
    <div className={className}>
      <label htmlFor={`f-${name}`} className="label">
        {label}
      </label>
      {children}
      {hint && !err && <p className="mt-1 text-xs text-faint">{hint}</p>}
      {err && (
        <p id={`err-${name}`} role="alert" className="mt-1 text-xs text-danger">
          {err}
        </p>
      )}
    </div>
  )
}

function AirportInput({ name, defaultValue, errors, placeholder }: { name: string; defaultValue: string; errors?: Record<string, string>; placeholder?: string }) {
  const [value, setValue] = useState(defaultValue)
  const [options, setOptions] = useState<{ iata: string; name: string; city: string; country: string }[]>([])
  const listId = useId()
  useEffect(() => {
    if (value.trim().length < 2) return
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      fetch(`/api/airports?q=${encodeURIComponent(value)}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((d: { items: typeof options }) => setOptions(d.items))
        .catch(() => {})
    }, 200)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [value])
  const match = options.find((o) => o.iata === value.trim().toUpperCase())
  return (
    <>
      <input
        id={`f-${name}`}
        name={name}
        list={listId}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={40}
        placeholder={placeholder}
        className={cx('field uppercase', errors?.[name] && 'border-danger')}
        aria-invalid={!!errors?.[name]}
        aria-describedby={errors?.[name] ? `err-${name}` : undefined}
        autoComplete="off"
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o.iata} value={o.iata}>
            {o.city} — {o.name}
          </option>
        ))}
      </datalist>
      {match && <p className="mt-1 text-xs text-muted">{`${match.name}, ${match.country}`}</p>}
    </>
  )
}

export function DealForm({ dealId, programs, initial }: { dealId: string | null; programs: Program[]; initial: Record<string, string> }) {
  const [state, action, pending] = useActionState<DealFormState, FormData>(saveDealAction.bind(null, dealId), { error: null })
  const v = state.values ?? initial
  const e = state.fieldErrors
  const [kind, setKind] = useState(v.kind || 'flight')
  const tags = new Set((v.tags ?? '').split(',').filter(Boolean))
  const input = (name: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input
      id={`f-${name}`}
      name={name}
      defaultValue={v[name] ?? ''}
      className={cx('field', e?.[name] && 'border-danger')}
      aria-invalid={!!e?.[name]}
      aria-describedby={e?.[name] ? `err-${name}` : undefined}
      {...props}
    />
  )
  const select = (name: string, options: readonly string[], labels: Record<string, string>, blank?: string) => (
    <select id={`f-${name}`} name={name} defaultValue={v[name] ?? ''} className="field">
      {blank !== undefined && <option value="">{blank}</option>}
      {options.map((o) => (
        <option key={o} value={o}>
          {labels[o] ?? o}
        </option>
      ))}
    </select>
  )
  const check = (name: string, label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={v[name] === 'on' || v[name] === 'true'} /> {label}
    </label>
  )

  return (
    // Remount after each failed attempt: React resets forms after an action, and selects would
    // otherwise snap back to their first-render defaults instead of what was submitted.
    <form key={state.attempt ?? 0} action={action} className="space-y-6" noValidate>
      {state.error && (
        <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
          {state.error}
        </p>
      )}
      <Card className="p-5">
        <fieldset>
          <legend className="font-display mb-3 text-xl">What is it?</legend>
          <div className="flex flex-wrap gap-2">
            {DEAL_KINDS.map((k) => (
              <label key={k} className={cx('cursor-pointer rounded-full border px-4 py-1.5 text-sm capitalize', kind === k ? 'border-primary bg-primary-soft text-primary' : 'border-line')}>
                <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="sr-only" />
                {k === 'package' ? 'Vacation package' : k}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Field name="providerName" label={kind === 'flight' ? 'Airline' : 'Hotel / provider'} errors={e}>
            {input('providerName', { required: true, maxLength: 200 })}
          </Field>
          <Field name="programId" label="Book with" errors={e}>
            <select id="f-programId" name="programId" defaultValue={v.programId ?? ''} className="field" required>
              <option value="">Choose a program…</option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field name="title" label="Title (optional)" errors={e}>
            {input('title', { maxLength: 200 })}
          </Field>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="font-display mb-3 text-xl">Where and when</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {kind === 'flight' && (
            <Field name="originAirport" label="From (airport)" errors={e}>
              <AirportInput name="originAirport" defaultValue={v.originAirport ?? ''} errors={e} placeholder="LAX" />
            </Field>
          )}
          <Field name="destAirport" label={kind === 'flight' ? 'To (airport)' : 'Nearest airport'} errors={e}>
            <AirportInput name="destAirport" defaultValue={v.destAirport ?? ''} errors={e} placeholder="HND" />
          </Field>
          <Field name="destCity" label="Destination city" errors={e}>
            {input('destCity', { required: true, maxLength: 120 })}
          </Field>
          <Field name="destCountry" label="Country (if no airport)" errors={e}>
            {input('destCountry', { maxLength: 120 })}
          </Field>
          <Field name="travelStart" label={kind === 'flight' ? 'Departure date' : 'Check-in'} errors={e}>
            {input('travelStart', { type: 'date' })}
          </Field>
          <Field name="travelEnd" label={kind === 'flight' ? 'Latest date (if flexible)' : 'Check-out'} errors={e}>
            {input('travelEnd', { type: 'date' })}
          </Field>
        </div>
        <div className="mt-3">{check('flexibleDates', 'Dates are a flexible window, not a fixed day')}</div>
      </Card>

      <Card className="p-5">
        <h2 className="font-display mb-1 text-xl">Price</h2>
        <p className="mb-3 text-sm text-muted">Enter what you saw on official sites. Leave unknown values blank — the app will say value cannot be calculated rather than guess.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field name="programPoints" label="Points / miles required" errors={e} hint="In the program's own currency">
            {input('programPoints', { type: 'number', min: 0, inputMode: 'numeric' })}
          </Field>
          <Field name="mandatoryCashUsd" label="Taxes, fees & mandatory costs (USD)" errors={e} hint="Include resort fees and required transfers">
            {input('mandatoryCashUsd', { type: 'number', min: 0, step: '0.01' })}
          </Field>
          <Field name="comparableCashUsd" label="Comparable cash price (USD)" errors={e} hint="Same route/dates/cabin or same room">
            {input('comparableCashUsd', { type: 'number', min: 0, step: '0.01' })}
          </Field>
          <Field name="comparableCashSource" label="Where the cash price came from" errors={e}>
            {select('comparableCashSource', CASH_SOURCES, CASH_SOURCE_LABELS)}
          </Field>
          <Field name="alternativeCashUsd" label="Realistic alternative you'd pay (optional)" errors={e} hint="e.g. a cheaper comparable fare">
            {input('alternativeCashUsd', { type: 'number', min: 0, step: '0.01' })}
          </Field>
        </div>
      </Card>

      {kind === 'flight' ? (
        <Card className="p-5">
          <h2 className="font-display mb-3 text-xl">Flight details</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field name="cabin" label="Award cabin" errors={e}>
              {select('cabin', CABINS, CABIN_LABELS, 'Choose…')}
            </Field>
            <Field name="seatType" label="Seat" errors={e}>
              {select('seatType', SEAT_TYPES, SEAT_TYPE_LABELS)}
            </Field>
            <Field name="operatingAirline" label="Operating airline" errors={e}>
              {input('operatingAirline', { maxLength: 120 })}
            </Field>
            <Field name="flightNumbers" label="Flight numbers" errors={e} hint="Comma separated">
              {input('flightNumbers', { maxLength: 100 })}
            </Field>
            <Field name="aircraft" label="Aircraft" errors={e}>
              {input('aircraft', { maxLength: 120 })}
            </Field>
            <Field name="stops" label="Stops" errors={e}>
              {input('stops', { type: 'number', min: 0, max: 6 })}
            </Field>
            <Field name="durationMinutes" label="Total duration (minutes)" errors={e}>
              {input('durationMinutes', { type: 'number', min: 0 })}
            </Field>
            <Field name="connectionMinutes" label="Connection times (minutes)" errors={e} hint="Comma separated">
              {input('connectionMinutes', { maxLength: 60 })}
            </Field>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {check('directAisleAccess', 'Direct aisle access')}
            {check('mixedCabin', 'Some segments in a lower cabin')}
            {check('overnightLayover', 'Overnight layover')}
            {check('separateTickets', 'Separate tickets')}
            {check('aircraftVerified', 'I verified the aircraft and seat map')}
          </div>
          <h3 className="mt-5 mb-2 text-sm font-semibold">The cash fare is for…</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field name="cashCabin" label="Cash fare cabin" errors={e}>
              {select('cashCabin', CABINS, CABIN_LABELS, 'Same as award')}
            </Field>
            <Field name="cashSeatType" label="Cash fare seat" errors={e}>
              {select('cashSeatType', SEAT_TYPES, SEAT_TYPE_LABELS, 'Not recorded')}
            </Field>
            <div className="self-end pb-2">{check('cashRefundable', 'Refundable fare')}</div>
          </div>
        </Card>
      ) : (
        <Card className="p-5">
          <h2 className="font-display mb-3 text-xl">Property &amp; room</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field name="property" label="Property" errors={e}>
              {input('property', { maxLength: 200 })}
            </Field>
            <Field name="roomCategory" label="Exact room booked with points" errors={e}>
              {input('roomCategory', { maxLength: 200 })}
            </Field>
            <Field name="roomType" label="Room type" errors={e}>
              {select('roomType', ROOM_TYPES, ROOM_TYPE_LABELS)}
            </Field>
            <Field name="guests" label="Guests" errors={e}>
              {input('guests', { type: 'number', min: 1, max: 12 })}
            </Field>
            <Field name="nights" label="Nights" errors={e} hint="Calculated from dates if blank">
              {input('nights', { type: 'number', min: 0 })}
            </Field>
            <Field name="programCategory" label="Program category" errors={e}>
              {input('programCategory', { maxLength: 60, placeholder: 'e.g. Category 7' })}
            </Field>
            <Field name="meals" label="Meals included" errors={e}>
              {input('meals', { maxLength: 120 })}
            </Field>
            <Field name="resortFeeUsd" label="Resort fee (USD)" errors={e}>
              {input('resortFeeUsd', { type: 'number', min: 0 })}
            </Field>
            <Field name="mandatoryTransfer" label="Mandatory transfer" errors={e}>
              {input('mandatoryTransfer', { maxLength: 200, placeholder: 'e.g. Seaplane' })}
            </Field>
            <Field name="cancellation" label="Cancellation rules" errors={e} className="sm:col-span-3">
              {input('cancellation', { maxLength: 200 })}
            </Field>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {check('isStandardAward', 'Standard award (not a premium room upcharge)')}
            {check('roomVerified', 'I verified the room category on the booking page')}
          </div>
          <h3 className="mt-5 mb-2 text-sm font-semibold">The cash rate is for…</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field name="cashRoomType" label="Cash rate room type" errors={e}>
              {select('cashRoomType', ROOM_TYPES, ROOM_TYPE_LABELS, 'Not recorded')}
            </Field>
            <div className="self-end pb-2">{check('cashMealsIncluded', 'Cash rate includes meals')}</div>
          </div>
        </Card>
      )}

      <Card className="p-5">
        <h2 className="font-display mb-3 text-xl">Evidence &amp; deadline</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field name="availability" label="Availability" errors={e}>
            {select('availability', AVAILABILITY, { available: 'Available when I checked', unavailable: 'Not available', unknown: 'Not checked' })}
          </Field>
          <Field name="sourceUrl" label="Source link (optional)" errors={e}>
            {input('sourceUrl', { type: 'url', placeholder: 'https://…' })}
          </Field>
          <Field name="bookingUrl" label="Official booking link (optional)" errors={e}>
            {input('bookingUrl', { type: 'url', placeholder: 'https://…' })}
          </Field>
          <Field name="sourceName" label="Source name" errors={e}>
            {input('sourceName', { maxLength: 120, placeholder: 'e.g. united.com award search' })}
          </Field>
          <Field name="imageUrl" label="Photo URL (optional)" errors={e} hint="Only images you are allowed to use">
            {input('imageUrl', { type: 'url' })}
          </Field>
        </div>
        <div className="mt-3">{check('verifiedNow', 'I just confirmed this is available on the official site (time-stamps it as verified)')}</div>
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <Field name="deadlineType" label="Deadline" errors={e}>
            {select('deadlineType', ['none', 'confirmed', 'observed', 'estimated'], {
              none: 'No known deadline',
              confirmed: 'Confirmed (documented end)',
              observed: 'Available at last check',
              estimated: 'Probably short-lived',
            })}
          </Field>
          <Field name="deadlineAt" label="Book by (confirmed only)" errors={e}>
            {input('deadlineAt', { type: 'datetime-local' })}
          </Field>
          <Field name="deadlineTimezone" label="Deadline time zone" errors={e}>
            {input('deadlineTimezone', { placeholder: 'America/New_York' })}
          </Field>
          <Field name="deadlineSource" label="Where the deadline is documented" errors={e}>
            {input('deadlineSource', { maxLength: 300 })}
          </Field>
        </div>
        <Field name="whyNoteworthy" label="Why it's noteworthy (optional)" errors={e} className="mt-3">
          <textarea id="f-whyNoteworthy" name="whyNoteworthy" defaultValue={v.whyNoteworthy ?? ''} maxLength={600} className="field min-h-20" />
        </Field>
        <fieldset className="mt-4">
          <legend className="label">Tags (shape personal match)</legend>
          <div className="flex flex-wrap gap-2">
            {TRAVEL_TAGS.map((t) => (
              <label key={t} className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs">
                <input type="checkbox" name="tags" value={t} defaultChecked={tags.has(t)} /> {TAG_LABELS[t]}
              </label>
            ))}
          </div>
        </fieldset>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? 'Saving…' : dealId ? 'Save changes' : 'Add deal'}
        </Button>
        <p className="text-xs text-muted">If a deal with the same route/property and dates exists, this is recorded as a new observation instead of a duplicate.</p>
      </div>
    </form>
  )
}
