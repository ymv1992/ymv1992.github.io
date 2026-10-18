'use client'

import { useState, useTransition } from 'react'
import { explainDealAction } from '@/app/actions/ai-actions'
import { Icon } from '../icons'
import { Badge, Button } from '../ui'

/** Optional AI-written explanation; clearly labelled and generated from computed facts only. */
export function DealExplainer({ dealId, enabled }: { dealId: string; enabled: boolean }) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  if (!enabled) return null
  return (
    <div className="mt-4 rounded-xl border border-line bg-surface-2 p-3">
      {text ? (
        <>
          <Badge tone="primary">AI-written · from the facts above</Badge>
          <p className="mt-2 text-sm whitespace-pre-line">{text}</p>
        </>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null)
              const res = await explainDealAction(dealId).catch(() => ({ ok: false, text: 'Network problem' }))
              if (res.ok) setText(res.text)
              else setError(res.text)
            })
          }
        >
          <Icon name="sparkles" className="size-4" />
          {pending ? 'Writing…' : 'Explain this deal (AI)'}
        </Button>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
