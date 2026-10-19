'use client'

import { useState, useTransition } from 'react'
import { saveDealAction, unsaveDealAction } from '@/app/actions/deal-actions'
import { Icon } from '../icons'
import { cx } from '../ui'

export function SaveToggle({ dealId, saved, compact = false }: { dealId: string; saved: boolean; compact?: boolean }) {
  const [isSaved, setSaved] = useState(saved)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  return (
    <>
      <button
        type="button"
        disabled={pending}
        aria-pressed={isSaved}
        onClick={() =>
          start(async () => {
            setError(null)
            const next = !isSaved
            setSaved(next)
            const res = next ? await saveDealAction(dealId) : await unsaveDealAction(dealId)
            if (!res.ok) {
              setSaved(!next)
              setError(res.message ?? 'Could not update')
            }
          })
        }
        className={cx(
          'inline-flex items-center gap-1 rounded-full border font-medium transition-colors',
          compact ? 'h-7 px-2.5 text-xs' : 'h-10 px-4 text-sm',
          isSaved ? 'border-primary bg-primary-soft text-primary' : 'border-line bg-surface text-muted hover:text-ink',
        )}
      >
        <Icon name={isSaved ? 'check' : 'bookmark'} className={compact ? 'size-3.5' : 'size-4'} />
        {isSaved ? 'Saved' : 'Save'}
      </button>
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </>
  )
}
