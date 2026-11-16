import Link from 'next/link'
import { logout } from '../login/actions'
import { requireUserId } from '@/lib/server/session'
import { ThemeToggle } from '@/components/forms'
import { SidebarNav, TopNav } from '@/components/nav'
import { Disclaimer } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUserId()
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[250px_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <aside className="hidden border-r border-line px-3 py-7 lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:overflow-y-auto">
        <Link href="/" className="mb-8 block px-3">
          <span className="font-display text-2xl tracking-tight">Vanta Wealth</span>
          <span className="eyebrow mt-1 block !text-gold">Private command center</span>
        </Link>
        <SidebarNav />
        <div className="mt-auto flex items-center justify-between gap-2 px-3 pt-6">
          <ThemeToggle />
          <form action={logout}>
            <button type="submit" className="text-xs text-muted hover:text-ink">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-30 bg-bg/90 backdrop-blur lg:hidden">
          <div className="flex h-14 items-center justify-between gap-3 px-4">
            <Link href="/" className="font-display text-xl tracking-tight">
              Vanta Wealth
            </Link>
            <div className="flex items-center gap-3">
              <ThemeToggle />
              <form action={logout}>
                <button type="submit" className="text-xs text-muted">
                  Sign out
                </button>
              </form>
            </div>
          </div>
          <TopNav />
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl px-4 pt-6 pb-16 sm:px-6 lg:px-10 lg:pt-10">
          {children}
          <Disclaimer />
        </main>
      </div>
    </div>
  )
}
