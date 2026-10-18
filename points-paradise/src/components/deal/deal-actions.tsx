'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import {
  archiveDealAction,
  deleteDealAction,
  passDealAction,
  rateDealAction,
  restoreDealAction,
  verifyDealAction,
  watchDealAction,
  type ActionResult,
} from '@/app/actions/deal-actions'
import { Icon } from '../icons'
import { Button, buttonClass } from '../ui'
import { SaveToggle } from './save-toggle'

interface Props {
  dealId: string
  saved: boolean
  isDemo: boolean
  archived: boolean
  editable: boolean
  watched: boolean
}

export function DealActions({ dealId, saved, isDemo, archived, editable, watched }: Props) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [rating, setRating] = useState(0)

  function run(fn: () => Promise<ActionResult>, after?: () => void) {
    start(async () => {
      try {
        const res = await fn()
        setMsg({ ok: res.ok, text: res.message ?? (res.ok ? 'Done' : 'Something went wrong') })
        if (res.ok) after?.()
      } catch {
        setMsg({ ok: false, text: 'Network problem — nothing was changed.' })
      }
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <SaveToggle dealId={dealId} saved={saved} />
        <Button variant="secondary" disabled={pending || isDemo} onClick={() => run(() => watchDealAction(dealId))} title={isDemo ? 'Demo deals cannot be watched' : undefined}>
          <Icon name="eye" className="size-4" /> {watched ? 'Watching' : 'Watch this deal'}
        </Button>
        {!isDemo && !archived && (
          <>
            <Button variant="secondary" disabled={pending} onClick={() => run(() => verifyDealAction(dealId, true))}>
              <Icon name="check" className="size-4" /> I just confirmed it&apos;s available
            </Button>
            <Button variant="danger" disabled={pending} onClick={() => run(() => verifyDealAction(dealId, false))}>
              No longer available
            </Button>
          </>
        )}
        <Button variant="ghost" disabled={pending} onClick={() => run(() => passDealAction(dealId), () => setMsg({ ok: true, text: 'Passed — hidden from Discover. Recover it in History → Passed.' }))}>
          <Icon name="x" className="size-4" /> Not interested
        </Button>
        {editable && (
          <Link href={`/deals/${dealId}/edit`} className={buttonClass('ghost')}>
            Edit
          </Link>
        )}
        {archived ? (
          <Button variant="ghost" disabled={pending} onClick={() => run(() => restoreDealAction(dealId))}>
            Restore from History
          </Button>
        ) : (
          <Button variant="ghost" disabled={pending} onClick={() => run(() => archiveDealAction(dealId))}>
            <Icon name="archive" className="size-4" /> Archive
          </Button>
        )}
        {editable && (
          <Button
            variant="ghost"
            className="text-danger"
            disabled={pending}
            onClick={() => {
              if (window.confirm('Delete this deal permanently? Its price history is deleted too.')) run(() => deleteDealAction(dealId), () => router.push('/discover'))
            }}
          >
            Delete
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted">Rate this idea:</span>
        <div role="radiogroup" aria-label="Rating" className="flex">
          {[1, 2, 3, 4, 5].map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={rating === r}
              aria-label={`${r} star${r > 1 ? 's' : ''}`}
              disabled={pending}
              onClick={() => {
                setRating(r)
                run(() => rateDealAction(dealId, r))
              }}
              className={r <= rating ? 'text-gold' : 'text-faint hover:text-gold'}
            >
              ★
            </button>
          ))}
        </div>
      </div>
      {msg && (
        <p role="status" className={msg.ok ? 'text-sm text-ok' : 'text-sm text-danger'}>
          {msg.text}
        </p>
      )}
    </div>
  )
}
