'use client'

import { useActionState, useState } from 'react'
import { importDealsAction, type ImportState } from '@/app/actions/deal-form-actions'
import { Button } from '../ui'

export function ImportForm() {
  const [state, action, pending] = useActionState<ImportState, FormData>(importDealsAction, { error: null })
  const [text, setText] = useState('')
  return (
    <form action={action} className="space-y-3">
      <div>
        <label htmlFor="import-file" className="label">
          Choose a .json or .csv file
        </label>
        <input
          id="import-file"
          type="file"
          accept=".json,.csv,application/json,text/csv"
          className="text-sm"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            if (f) setText(await f.text())
          }}
        />
      </div>
      <div>
        <label htmlFor="payload" className="label">
          …or paste the contents
        </label>
        <textarea id="payload" name="payload" value={text} onChange={(e) => setText(e.target.value)} className="field min-h-48 font-mono text-xs" spellCheck={false} />
      </div>
      <Button type="submit" disabled={pending || !text.trim()}>
        {pending ? 'Importing…' : 'Import deals'}
      </Button>
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.created != null && (
        <div role="status" className="rounded-xl bg-surface-2 p-3 text-sm">
          <p>
            <strong>{state.created}</strong> new deals, <strong>{state.merged}</strong> merged into existing deals as new observations, <strong>{state.failures?.length ?? 0}</strong> rows rejected.
          </p>
          {state.failures && state.failures.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-danger">
              {state.failures.map((f) => (
                <li key={f.row}>
                  Row {f.row}: {f.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  )
}
