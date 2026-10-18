'use client'

import { useState, useTransition } from 'react'
import { narrateTripAction } from '@/app/actions/ai-actions'
import { Badge, Button } from '../ui'

export function TripNarrative({ facts }: { facts: Record<string, unknown> }) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  if (text) {
    return (
      <div className="rounded-xl bg-surface-2 p-3 text-sm">
        <Badge tone="primary">AI-written · from the facts shown</Badge>
        <p className="mt-2 whitespace-pre-line">{text}</p>
      </div>
    )
  }
  return (
    <div>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await narrateTripAction(facts).catch(() => ({ ok: false, text: 'Network problem' }))
            if (r.ok) setText(r.text)
            else setError(r.text)
          })
        }
      >
        {pending ? 'Writing…' : 'Describe this trip (AI)'}
      </Button>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  )
}
