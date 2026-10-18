import Link from 'next/link'
import { CABINS, CABIN_LABELS, REGIONS, REGION_LABELS } from '@/lib/domain/constants'
import { SORT_OPTIONS } from '@/lib/engine/ranking'
import { STATUS_GROUPS } from '@/lib/view/filters'

/** Plain GET form, so filtering works without JavaScript and every view has a shareable URL. */
export function FilterForm({ action, raw, active, includeDemo }: { action: string; raw: Record<string, string>; active: number; includeDemo: boolean }) {
  return (
    <form method="get" action={action} className="mb-6">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <label htmlFor="q" className="label">
            Search
          </label>
          <input id="q" name="q" defaultValue={raw.q} placeholder="Destination, airline, hotel…" className="field" />
        </div>
        <div>
          <label htmlFor="sort" className="label">
            Sort
          </label>
          <select id="sort" name="sort" defaultValue={raw.sort ?? 'efficiency'} className="field">
            {SORT_OPTIONS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="h-10 rounded-full bg-primary px-4 text-sm font-medium text-primary-ink">
          Apply
        </button>
        {active > 0 && (
          <Link href={action} className="h-10 rounded-full px-3 text-sm leading-10 text-muted underline-offset-2 hover:underline">
            Clear filters
          </Link>
        )}
      </div>
      <details className="mt-3 rounded-2xl border border-line bg-surface p-4" open={active > 0 ? true : undefined}>
        <summary className="cursor-pointer text-sm font-semibold">
          More filters{active > 0 ? ` (${active} active)` : ''}
        </summary>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <div>
            <label htmlFor="region" className="label">
              Region
            </label>
            <select id="region" name="region" defaultValue={raw.region ?? ''} className="field">
              <option value="">Any</option>
              {REGIONS.map((r) => (
                <option key={r} value={r}>
                  {REGION_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="from" className="label">
              Departure airport
            </label>
            <input id="from" name="from" defaultValue={raw.from} maxLength={3} placeholder="LAX" className="field uppercase" />
          </div>
          <div>
            <label htmlFor="cabin" className="label">
              Cabin
            </label>
            <select id="cabin" name="cabin" defaultValue={raw.cabin ?? ''} className="field">
              <option value="">Any</option>
              {CABINS.map((c) => (
                <option key={c} value={c}>
                  {CABIN_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="hotelCat" className="label">
              Hotel category
            </label>
            <input id="hotelCat" name="hotelCat" defaultValue={raw.hotelCat} placeholder="e.g. Category 7" className="field" />
          </div>
          <div>
            <label htmlFor="maxPoints" className="label">
              Max Chase points
            </label>
            <input id="maxPoints" name="maxPoints" type="number" min={0} step={1000} defaultValue={raw.maxPoints} className="field" />
          </div>
          <div>
            <label htmlFor="maxCash" className="label">
              Max cash (USD)
            </label>
            <input id="maxCash" name="maxCash" type="number" min={0} step={50} defaultValue={raw.maxCash} className="field" />
          </div>
          <div>
            <label htmlFor="minCpp" className="label">
              Min ¢ per point
            </label>
            <input id="minCpp" name="minCpp" type="number" min={0} step={0.1} defaultValue={raw.minCpp} className="field" />
          </div>
          <div>
            <label htmlFor="status" className="label">
              Verification
            </label>
            <select id="status" name="status" defaultValue={raw.status ?? ''} className="field">
              <option value="">Any evidence</option>
              {Object.entries(STATUS_GROUPS)
                .filter(([k]) => includeDemo || k !== 'demo')
                .map(([k, g]) => (
                  <option key={k} value={k}>
                    {g.label}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label htmlFor="dateFrom" className="label">
              Travel from
            </label>
            <input id="dateFrom" name="dateFrom" type="date" defaultValue={raw.dateFrom} className="field" />
          </div>
          <div>
            <label htmlFor="dateTo" className="label">
              Travel to
            </label>
            <input id="dateTo" name="dateTo" type="date" defaultValue={raw.dateTo} className="field" />
          </div>
          <div>
            <label htmlFor="minNights" className="label">
              Min nights
            </label>
            <input id="minNights" name="minNights" type="number" min={0} defaultValue={raw.minNights} className="field" />
          </div>
          <div>
            <label htmlFor="maxNights" className="label">
              Max nights
            </label>
            <input id="maxNights" name="maxNights" type="number" min={0} defaultValue={raw.maxNights} className="field" />
          </div>
          <div>
            <label htmlFor="deadlineDays" className="label">
              Deadline within (days)
            </label>
            <input id="deadlineDays" name="deadlineDays" type="number" min={0} defaultValue={raw.deadlineDays} className="field" />
          </div>
          <div>
            <label htmlFor="positioning" className="label">
              Positioning
            </label>
            <select id="positioning" name="positioning" defaultValue={raw.positioning ?? ''} className="field">
              <option value="">Any</option>
              <option value="no">From my airports only</option>
              <option value="yes">Requires positioning</option>
            </select>
          </div>
          <div>
            <label htmlFor="saved" className="label">
              Saved
            </label>
            <select id="saved" name="saved" defaultValue={raw.saved ?? ''} className="field">
              <option value="">Saved or not</option>
              <option value="saved">Saved only</option>
              <option value="unsaved">Not saved</option>
            </select>
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" name="nonstop" defaultChecked={raw.nonstop === 'on'} />
            Nonstop flights only
          </label>
        </div>
      </details>
    </form>
  )
}
