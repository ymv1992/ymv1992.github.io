'use client'

import { useActionState } from 'react'
import { applyImportAction, previewImportAction, type ImportPreview } from '@/app/actions'
import { price, qty } from '@/lib/format'
import { ActionForm } from './forms'
import { Badge, Button } from './ui'

const CHANGE = { new: { tone: 'gold', label: 'New' }, changed: { tone: 'warn', label: 'Differs from saved' }, same: { tone: 'neutral', label: 'Already saved' } } as const

/** Two-step import: preview what would change, then confirm. Nothing is written by the preview. */
export function ImportPanel({ today }: { today: string }) {
  const [preview, previewAction, pending] = useActionState<ImportPreview, FormData>(previewImportAction, { error: null, rows: [], warnings: [] })
  const changed = preview.rows.filter((r) => r.change === 'changed').length
  const fresh = preview.rows.filter((r) => r.change === 'new').length
  return (
    <div className="space-y-5">
      <form action={previewAction} className="space-y-3">
        <label className="label" htmlFor="import-text">
          Paste holdings or the contents of a CSV file
        </label>
        <textarea id="import-text" name="text" rows={5} className="field num text-sm" placeholder={'VTI 4 / $357.49\nBTC 1\n\nor a CSV with headers:\nSymbol,Shares,Avg Cost,Account'} />
        <p className="text-xs text-muted">One holding per line as “symbol, quantity, average cost”, or a CSV with Symbol and Shares columns. Use “?” or leave the cost blank when you do not know it.</p>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? 'Reading…' : 'Preview import'}
        </Button>
        {preview.error && (
          <p role="alert" className="text-sm text-danger">
            {preview.error}
          </p>
        )}
      </form>

      {preview.rows.length > 0 && (
        <div className="space-y-4 rounded-xl border border-line p-4">
          <p className="text-sm text-ink">
            Check this against your statement before saving. <span className="num">{fresh}</span> new, <span className="num">{changed}</span> differ from what is saved, <span className="num">{preview.rows.length - fresh - changed}</span> already match.
          </p>
          {preview.warnings.map((w) => (
            <p key={w} className="text-xs text-warn">{w}</p>
          ))}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="eyebrow border-b border-line text-left">
                  <th className="py-2 pr-3 font-semibold">Symbol</th>
                  <th className="py-2 pr-3 text-right font-semibold">Quantity</th>
                  <th className="py-2 pr-3 text-right font-semibold">Avg cost</th>
                  <th className="py-2 font-semibold">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {preview.rows.map((r) => (
                  <tr key={`${r.account}|${r.symbol}`}>
                    <td className="num py-2 pr-3 text-ink">{r.symbol}</td>
                    <td className="num py-2 pr-3 text-right">{qty(r.quantity)}</td>
                    <td className="num py-2 pr-3 text-right">{r.avgCost == null ? '?' : price(r.avgCost)}</td>
                    <td className="py-2">
                      <Badge tone={CHANGE[r.change].tone}>{CHANGE[r.change].label}</Badge>
                      {r.change === 'changed' && r.existing && (
                        <span className="num ml-2 text-xs text-muted">
                          saved: {qty(r.existing.quantity)} @ {r.existing.avgCost == null ? '?' : price(r.existing.avgCost)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ActionForm action={applyImportAction} submitLabel="Confirm and save" className="space-y-3">
            <input type="hidden" name="rows" value={JSON.stringify(preview.rows.map(({ symbol, quantity, avgCost, name, account, purchaseDate }) => ({ symbol, quantity, avgCost, name, account, purchaseDate })))} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="import-status">Mark these as</label>
                <select id="import-status" name="status" className="field" defaultValue="confirmed">
                  <option value="confirmed">Confirmed — I checked them against my account</option>
                  <option value="unverified">Unverified — reconciliation required</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="import-asof">As of</label>
                <input id="import-asof" name="asOf" type="date" className="field num" defaultValue={today} />
              </div>
            </div>
            {changed > 0 && (
              <label className="flex items-start gap-2 text-sm text-ink">
                <input type="checkbox" name="replace" className="mt-1" />
                <span>
                  Replace the saved values for the <span className="num">{changed}</span> holdings that differ. Left unticked, they are not touched.
                </span>
              </label>
            )}
          </ActionForm>
        </div>
      )}
    </div>
  )
}
