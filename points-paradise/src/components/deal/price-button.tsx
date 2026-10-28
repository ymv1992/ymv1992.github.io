'use client'

import { useState, useTransition } from 'react'
import { priceDealAction } from '@/app/actions/search-actions'

/**
 * Shows a deal's value when its cash price is known; otherwise offers a
 * one-tap cash lookup (one SerpApi search from the free monthly allowance).
 */
export function PriceButton({ dealId, cpp, cashUsd, tried, canPrice }: { dealId: string; cpp: number | null; cashUsd: number | null; tried: boolean; canPrice: boolean }) {
  const [pending, start] = useTransition()
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  if (cpp != null) return <span className="tabular text-sm font-semibold text-ok">{cpp.toFixed(2)}¢/pt</span>
  if (result) return <span className={`text-xs ${result.ok ? 'font-semibold text-ok' : 'text-muted'}`}>{result.message}</span>
  if (cashUsd != null) return <span className="text-xs text-muted">${Math.round(cashUsd).toLocaleString('en-US')} cash · value not comparable</span>
  if (!canPrice) return null
  return (
    <button
      type="button"
      disabled={pending}
      onClick={(e) => {
        // Rows are links; keep the click on the button.
        e.preventDefault()
        e.stopPropagation()
        start(async () => setResult(await priceDealAction(dealId)))
      }}
      className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-primary hover:bg-surface-2 disabled:opacity-60"
      title={tried ? 'Checked recently without a match; this uses another free lookup' : 'Uses one of your free monthly cash-price lookups'}
    >
      {pending ? 'Checking…' : tried ? 'Try cash price again' : 'Get cash price'}
    </button>
  )
}
