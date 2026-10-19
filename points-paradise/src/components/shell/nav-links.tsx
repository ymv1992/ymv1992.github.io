'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Icon } from '../icons'
import { cx } from '../ui'
import { MOBILE_NAV, NAV_SECTIONS } from './nav-config'

function isActive(pathname: string, href: string): boolean {
  if (href === '/me') return pathname === '/me'
  if (href === '/top') return pathname === '/top' || pathname.startsWith('/categories')
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function SidebarNav() {
  const pathname = usePathname()
  return (
    <nav aria-label="Main" className="space-y-6">
      {NAV_SECTIONS.map((section) => (
        <div key={section.title}>
          <p className="mb-2 px-3 text-[11px] font-semibold tracking-[0.16em] text-faint uppercase">{section.title}</p>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cx(
                      'flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors',
                      active ? 'bg-primary-soft font-semibold text-primary' : 'text-muted hover:bg-surface-2 hover:text-ink',
                    )}
                  >
                    <Icon name={item.icon} className="size-[18px]" />
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}

export function MobileNav() {
  const pathname = usePathname()
  return (
    <nav aria-label="Main" className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur lg:hidden">
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {MOBILE_NAV.map((item) => {
          const active = isActive(pathname, item.href)
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cx('flex flex-col items-center gap-0.5 py-2.5 text-[11px]', active ? 'font-semibold text-primary' : 'text-muted')}
              >
                <Icon name={item.icon} className="size-[22px]" />
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
