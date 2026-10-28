'use client'

import { useRouter } from 'next/navigation'
import { buttonClass } from '../ui'

export function BackButton({ label = 'Go back' }: { label?: string }) {
  const router = useRouter()
  return (
    <button type="button" onClick={() => router.back()} className={buttonClass('primary')}>
      {label}
    </button>
  )
}
