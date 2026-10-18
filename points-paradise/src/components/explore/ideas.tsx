'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { destinationIdeasAction } from '@/app/actions/ai-actions'
import { Icon } from '../icons'
import { Badge, Button } from '../ui'

type Idea = NonNullable<Awaited<ReturnType<typeof destinationIdeasAction>>['ideas']>[number]

export function Ideas() {
  const [ideas, setIdeas] = useState<Idea[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  return (
    <div>
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null)
            const r = await destinationIdeasAction().catch(() => ({ ok: false, message: 'Network problem', ideas: undefined }))
            if (r.ok && r.ideas) setIdeas(r.ideas)
            else setError(r.message ?? 'No ideas returned')
          })
        }
      >
        <Icon name="sparkles" className="size-4" /> {pending ? 'Thinking…' : 'Inspire me'}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      {ideas && (
        <div className="mt-4">
          <Badge tone="primary">AI-written ideas — no prices or availability</Badge>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {ideas.map((i) => (
              <li key={`${i.destination}-${i.country}`} className="rounded-2xl border border-line bg-surface p-4 text-sm">
                <p className="font-display text-lg">
                  {i.destination}, {i.country}
                </p>
                <p className="mt-1 text-muted">{i.why}</p>
                <p className="mt-2 text-xs">
                  <strong>Best months:</strong> {i.bestMonths}
                </p>
                <p className="text-xs">
                  <strong>Programs to check:</strong> {i.programsToCheck.join(', ')}
                </p>
                <p className="text-xs text-muted">{i.searchTip}</p>
                <div className="mt-2 flex gap-3 text-xs">
                  <Link className="text-primary" href={`/explore?q=${encodeURIComponent(i.destination)}`}>
                    Find deals
                  </Link>
                  <Link className="text-primary" href={`/deals/new?city=${encodeURIComponent(i.destination)}&country=${encodeURIComponent(i.country)}`}>
                    Add a deal I found
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
