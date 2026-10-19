'use client'

import { useEffect, useState } from 'react'
import { formatCountdown } from '@/lib/engine/deadlines'

/**
 * Live countdown for confirmed deadlines only. The first render uses the
 * server's clock so server and client markup match, then it ticks locally.
 */
export function Countdown({ targetIso, nowMs, prefix = 'Ends in ' }: { targetIso: string; nowMs: number; prefix?: string }) {
  const target = Date.parse(targetIso)
  const [now, setNow] = useState(nowMs)
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const first = setTimeout(tick, 0)
    const id = setInterval(tick, 30_000)
    return () => {
      clearTimeout(first)
      clearInterval(id)
    }
  }, [])
  const ms = target - now
  const urgent = ms > 0 && ms < 24 * 3_600_000
  return (
    <time dateTime={targetIso} className={urgent ? 'font-semibold text-danger' : undefined}>
      {ms > 0 ? `${prefix}${formatCountdown(ms)}` : 'Ended'}
    </time>
  )
}
