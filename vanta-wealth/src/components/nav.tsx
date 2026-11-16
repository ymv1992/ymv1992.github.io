'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cx } from './ui'

export const NAV = [
  { href: '/', label: 'Command Center' },
  { href: '/portfolio', label: 'My Portfolio' },
  { href: '/strategy', label: 'Diversification' },
  { href: '/news', label: 'Market Watch' },
  { href: '/roadmap', label: 'Millionaire Roadmap' },
  { href: '/journal', label: 'Trade Journal' },
  { href: '/settings', label: 'Settings' },
  { href: '/modules', label: 'Coming Next' },
] as const

function active(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)
}

export function SidebarNav() {
  const pathname = usePathname()
  return (
    <nav aria-label="Main">
      <ul className="space-y-0.5">
        {NAV.map((item, i) => {
          const on = active(pathname, item.href)
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={on ? 'page' : undefined}
                className={cx('flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors', on ? 'bg-gold-soft font-medium text-gold' : 'text-muted hover:bg-surface-2 hover:text-ink')}
              >
                <span className="num w-5 text-[11px] text-faint">{String(i + 1).padStart(2, '0')}</span>
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** Horizontal menu under the top bar on phones and tablets. */
export function TopNav() {
  const pathname = usePathname()
  return (
    <nav aria-label="Main" className="no-scrollbar overflow-x-auto border-b border-line lg:hidden">
      <ul className="flex gap-1 px-3 py-2">
        {NAV.map((item) => {
          const on = active(pathname, item.href)
          return (
            <li key={item.href}>
              <Link href={item.href} aria-current={on ? 'page' : undefined} className={cx('block rounded-full px-3 py-1.5 text-sm whitespace-nowrap', on ? 'bg-gold-soft font-medium text-gold' : 'text-muted')}>
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
