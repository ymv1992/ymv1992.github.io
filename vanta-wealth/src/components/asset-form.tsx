import { saveAssetAction } from '@/app/actions'
import type { AssetRow } from '@/lib/data/store'
import { ASSET_CATEGORIES, ASSET_CATEGORY_LABELS, BUCKETS, BUCKET_LABELS } from '@/lib/domain/types'
import { ActionForm } from './forms'

export function AssetForm({ asset, today }: { asset?: AssetRow; today: string }) {
  const a = asset
  const k = a?.id ?? 'new'
  return (
    <ActionForm action={saveAssetAction} submitLabel={a ? 'Save' : 'Add asset'}>
      {a && <input type="hidden" name="id" value={a.id} />}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label" htmlFor={`name-${k}`}>Name</label>
          <input id={`name-${k}`} name="name" className="field" defaultValue={a?.name} placeholder="TSP, savings, home…" required maxLength={120} />
        </div>
        <div>
          <label className="label" htmlFor={`cat-${k}`}>Category</label>
          <select id={`cat-${k}`} name="category" className="field" defaultValue={a?.category ?? 'retirement'}>
            {ASSET_CATEGORIES.map((c) => (
              <option key={c} value={c}>{ASSET_CATEGORY_LABELS[c]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor={`value-${k}`}>Current value</label>
          <input id={`value-${k}`} name="value" className="field num" inputMode="decimal" defaultValue={a?.value ?? ''} placeholder="Blank until you check" />
        </div>
        <div>
          <label className="label" htmlFor={`liab-${k}`}>Debt against it</label>
          <input id={`liab-${k}`} name="liability" className="field num" inputMode="decimal" defaultValue={a?.liability || ''} placeholder="Mortgage or loan" />
        </div>
        <div>
          <label className="label" htmlFor={`asof-${k}`}>Value as of</label>
          <input id={`asof-${k}`} name="asOf" type="date" className="field num" defaultValue={a?.asOf ?? today} />
        </div>
        <div>
          <label className="label" htmlFor={`status-${k}`}>Verification</label>
          <select id={`status-${k}`} name="status" className="field" defaultValue={a?.status === 'verified' ? 'verified' : 'unverified'}>
            <option value="verified">Verified from a statement</option>
            <option value="unverified">Unverified estimate</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor={`bucket-${k}`}>Counts toward bucket</label>
          <select id={`bucket-${k}`} name="bucket" className="field" defaultValue={a?.bucket ?? ''}>
            <option value="">Not assigned</option>
            {BUCKETS.map((b) => (
              <option key={b} value={b}>{BUCKET_LABELS[b]}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col justify-end gap-2 text-sm text-ink">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="inPortfolio" defaultChecked={a ? a.inPortfolio : true} /> Part of my investable portfolio
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="liquid" defaultChecked={a?.liquid ?? false} /> Liquid (can be spent soon)
          </label>
        </div>
      </div>
      <div>
        <label className="label" htmlFor={`notes-${k}`}>Notes</label>
        <input id={`notes-${k}`} name="notes" className="field" defaultValue={a?.notes} placeholder="For a retirement account, list the funds it holds" />
      </div>
    </ActionForm>
  )
}
