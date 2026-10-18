'use client'

import { useSyncExternalStore } from 'react'
import { Icon } from '../icons'

type Theme = 'system' | 'light' | 'dark'
const ORDER: Theme[] = ['system', 'light', 'dark']
const LABEL: Record<Theme, string> = { system: 'Theme: match system', light: 'Theme: light', dark: 'Theme: dark' }

function read(): Theme {
  try {
    const t = localStorage.getItem('pp-theme')
    return t === 'light' || t === 'dark' ? t : 'system'
  } catch {
    return 'system'
  }
}

const listeners = new Set<() => void>()
function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function apply(t: Theme) {
  const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, read, () => 'system' as Theme)
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]!
  return (
    <button
      type="button"
      onClick={() => {
        try {
          localStorage.setItem('pp-theme', next)
        } catch {
          // Storage may be unavailable (private mode); the change still applies to this page.
        }
        apply(next)
        listeners.forEach((l) => l())
      }}
      className="inline-flex size-9 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
      aria-label={`${LABEL[theme]}. Switch to ${next}.`}
      title={LABEL[theme]}
    >
      <Icon name={theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'eye'} className="size-[18px]" />
    </button>
  )
}
