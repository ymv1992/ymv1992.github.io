'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { Icon } from '../icons'

interface Unread {
  id: string
  title: string
  body: string
  link: string
  createdAt: string
}

/**
 * Polls for unread alerts while the app is open and, if the owner enabled
 * browser notifications, shows new ones through the Notification API.
 */
export function AlertsBell({ initialCount, browserNotifications }: { initialCount: number; browserNotifications: boolean }) {
  const [count, setCount] = useState(initialCount)
  const [offline, setOffline] = useState(false)
  const shown = useRef<Set<string>>(new Set())

  useEffect(() => {
    let stopped = false
    try {
      const raw = sessionStorage.getItem('pp-shown-alerts')
      if (raw) shown.current = new Set(JSON.parse(raw) as string[])
    } catch {
      // ignore
    }
    async function poll() {
      try {
        const res = await fetch('/api/notifications/unread', { cache: 'no-store' })
        if (!res.ok) return
        const data = (await res.json()) as { items: Unread[] }
        if (stopped) return
        setOffline(false)
        setCount(data.items.length)
        if (browserNotifications && 'Notification' in window && Notification.permission === 'granted') {
          for (const n of data.items) {
            if (shown.current.has(n.id)) continue
            shown.current.add(n.id)
            const note = new Notification(n.title, { body: n.body, tag: n.id })
            note.onclick = () => {
              window.focus()
              window.location.href = n.link
            }
          }
          try {
            sessionStorage.setItem('pp-shown-alerts', JSON.stringify([...shown.current].slice(-200)))
          } catch {
            // ignore
          }
        }
      } catch {
        if (!stopped) setOffline(true)
      }
    }
    poll()
    const id = setInterval(poll, 60_000)
    const onOnline = () => poll()
    window.addEventListener('online', onOnline)
    return () => {
      stopped = true
      clearInterval(id)
      window.removeEventListener('online', onOnline)
    }
  }, [browserNotifications])

  return (
    <div className="flex items-center gap-2">
      {offline && (
        <span role="status" className="rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-semibold text-warn">
          Offline — data may be stale
        </span>
      )}
      <Link
        href="/alerts"
        className="relative inline-flex size-9 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
        aria-label={count ? `Alerts, ${count} unread` : 'Alerts'}
      >
        <Icon name="bell" className="size-[18px]" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-bold text-white dark:text-navy">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </Link>
    </div>
  )
}
