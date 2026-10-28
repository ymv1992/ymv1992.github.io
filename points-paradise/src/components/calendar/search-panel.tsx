'use client'

import { useState, type ReactNode } from 'react'
import { cx } from '../ui'

/** Flights | Hotels switch for the Award Calendar search. Both stay mounted so results survive switching. */
export function SearchPanel({ flights, hotels }: { flights: ReactNode; hotels: ReactNode }) {
  const [tab, setTab] = useState<'flights' | 'hotels'>('flights')
  return (
    <div>
      <div className="mb-4 inline-flex rounded-full border border-line bg-surface p-1" role="tablist" aria-label="Search type">
        {(['flights', 'hotels'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cx('rounded-full px-4 py-1.5 text-sm', tab === t ? 'bg-primary text-primary-ink' : 'text-muted')}
          >
            {t === 'flights' ? 'Flights' : 'Hotels'}
          </button>
        ))}
      </div>
      <div role="tabpanel" hidden={tab !== 'flights'}>
        {flights}
      </div>
      <div role="tabpanel" hidden={tab !== 'hotels'}>
        {hotels}
      </div>
    </div>
  )
}
