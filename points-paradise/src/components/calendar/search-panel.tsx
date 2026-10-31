'use client'

import { useState, type ReactNode } from 'react'
import { cx } from '../ui'

const LABEL = { flights: 'Award flights', hotels: 'Hotels', cash: 'Cash fares' } as const
type Tab = keyof typeof LABEL

/** Award flights | Hotels | Cash fares switch for the Award Calendar search. All stay mounted so results survive switching. */
export function SearchPanel({ flights, hotels, cash }: { flights: ReactNode; hotels: ReactNode; cash?: ReactNode }) {
  const [tab, setTab] = useState<Tab>('flights')
  const tabs: Tab[] = cash ? ['flights', 'hotels', 'cash'] : ['flights', 'hotels']
  const panels: Record<Tab, ReactNode> = { flights, hotels, cash }
  return (
    <div>
      <div className="mb-4 inline-flex max-w-full overflow-x-auto rounded-full border border-line bg-surface p-1" role="tablist" aria-label="Search type">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cx('shrink-0 rounded-full px-4 py-1.5 text-sm', tab === t ? 'bg-primary text-primary-ink' : 'text-muted')}
          >
            {LABEL[t]}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t} role="tabpanel" hidden={tab !== t}>
          {panels[t]}
        </div>
      ))}
    </div>
  )
}
