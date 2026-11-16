import { saveHoldingAction } from '@/app/actions'
import type { HoldingRow } from '@/lib/data/store'
import { ASSET_CLASSES, BUCKETS, BUCKET_LABELS, HOLDING_STATUSES, HOLDING_STATUS_LABELS } from '@/lib/domain/types'
import { ActionForm } from './forms'

const CLASS_LABELS = { stock: 'Stock', etf: 'Fund / ETF', crypto: 'Cryptocurrency' } as const

export function HoldingForm({ holding }: { holding?: HoldingRow }) {
  const h = holding
  return (
    <ActionForm action={saveHoldingAction} submitLabel={h ? 'Save changes' : 'Add holding'}>
      {h && <input type="hidden" name="id" value={h.id} />}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label" htmlFor="symbol">Symbol</label>
          <input id="symbol" name="symbol" className="field num uppercase" defaultValue={h?.symbol} required maxLength={12} placeholder="VTI" />
        </div>
        <div>
          <label className="label" htmlFor="quantity">Shares or units</label>
          <input id="quantity" name="quantity" className="field num" inputMode="decimal" defaultValue={h?.quantity} required />
        </div>
        <div>
          <label className="label" htmlFor="avgCost">Average cost per share</label>
          <input id="avgCost" name="avgCost" className="field num" inputMode="decimal" defaultValue={h?.avgCost ?? ''} placeholder="Blank if unknown" />
        </div>
        <div>
          <label className="label" htmlFor="account">Account</label>
          <input id="account" name="account" className="field" defaultValue={h?.account} maxLength={80} placeholder="Brokerage name" />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="name">Full name</label>
          <input id="name" name="name" className="field" defaultValue={h?.name} maxLength={120} />
        </div>
        <div>
          <label className="label" htmlFor="assetClass">Type</label>
          <select id="assetClass" name="assetClass" className="field" defaultValue={h?.assetClass ?? ''}>
            {!h && <option value="">Detect from symbol</option>}
            {ASSET_CLASSES.map((c) => (
              <option key={c} value={c}>{CLASS_LABELS[c]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="bucket">Bucket</label>
          <select id="bucket" name="bucket" className="field" defaultValue={h?.bucket ?? ''}>
            {!h && <option value="">Suggest from symbol</option>}
            {BUCKETS.map((b) => (
              <option key={b} value={b}>{BUCKET_LABELS[b]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="status">Verification</label>
          <select id="status" name="status" className="field" defaultValue={h?.status ?? 'confirmed'}>
            {HOLDING_STATUSES.map((s) => (
              <option key={s} value={s}>{HOLDING_STATUS_LABELS[s]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="asOf">Quantity as of</label>
          <input id="asOf" name="asOf" type="date" className="field num" defaultValue={h?.asOf ?? ''} />
        </div>
        <div>
          <label className="label" htmlFor="purchaseDate">First purchase date</label>
          <input id="purchaseDate" name="purchaseDate" type="date" className="field num" defaultValue={h?.purchaseDate ?? ''} />
        </div>
      </div>
      {h && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div>
            <label className="label" htmlFor="thesis">Why I own it (thesis)</label>
            <textarea id="thesis" name="thesis" rows={4} className="field" defaultValue={h.thesis} />
          </div>
          <div>
            <label className="label" htmlFor="sellCondition">What would make me sell or trim</label>
            <textarea id="sellCondition" name="sellCondition" rows={4} className="field" defaultValue={h.sellCondition} />
          </div>
          <div>
            <label className="label" htmlFor="notes">Notes</label>
            <textarea id="notes" name="notes" rows={4} className="field" defaultValue={h.notes} />
          </div>
        </div>
      )}
    </ActionForm>
  )
}
