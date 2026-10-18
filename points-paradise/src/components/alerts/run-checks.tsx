'use client'

import { useActionState } from 'react'
import { runChecksNowAction, type RunState } from '@/app/actions/job-actions'
import { Icon } from '../icons'
import { Button } from '../ui'

export function RunChecksButton() {
  const [state, action, pending] = useActionState<RunState>(runChecksNowAction, { error: null })
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <Button type="submit" variant="secondary" disabled={pending}>
        <Icon name="refresh" className="size-4" /> {pending ? 'Running checks…' : 'Run checks now'}
      </Button>
      {state.ok && (
        <p role="status" className="max-w-md text-right text-xs text-muted">
          {state.ok}
        </p>
      )}
      {state.error && (
        <p role="alert" className="text-xs text-danger">
          {state.error}
        </p>
      )}
    </form>
  )
}
