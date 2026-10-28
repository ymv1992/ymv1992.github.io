import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getDb } from '@/lib/db/client'
import { loadAccount } from '@/lib/data/account'
import { unreadNotifications } from '@/lib/data/notifications'
import { logout } from '@/app/login/actions'
import { getViewer, requireViewerId } from '@/lib/server/session'
import { points } from '@/lib/format'
import { AlertsBell } from '@/components/shell/alerts-bell'
import { MobileNav, SidebarNav } from '@/components/shell/nav-links'
import { ThemeToggle } from '@/components/shell/theme-toggle'

export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const userId = await requireViewerId()
  const guest = (await getViewer())?.guest ?? null
  const db = await getDb()
  const account = await loadAccount(db, userId)
  if (!account.settings.onboardingCompletedAt && !guest) redirect('/onboarding')
  const unread = await unreadNotifications(db, userId)

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <aside className="hidden border-r border-line bg-surface/60 px-3 py-6 lg:sticky lg:top-0 lg:block lg:h-dvh lg:overflow-y-auto">
        <Link href="/discover" className="mb-8 block px-3">
          <span className="font-display text-2xl">Points &amp; Paradise</span>
          <span className="block text-[11px] tracking-[0.18em] text-gold uppercase">Chase travel intelligence</span>
        </Link>
        <SidebarNav />
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-line bg-bg/85 px-4 backdrop-blur sm:px-6">
          <Link href="/discover" className="font-display text-lg lg:hidden">
            Points &amp; Paradise
          </Link>
          <div className="hidden lg:block" />
          <div className="flex items-center gap-1">
            <Link
              href="/settings#wallet"
              className="tabular mr-1 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-ink hover:bg-surface-2"
              title="Your Chase Ultimate Rewards balance"
            >
              {points(account.wallet.chaseBalance)} <span className="text-faint">pts</span>
            </Link>
            <AlertsBell initialCount={unread.length} browserNotifications={account.settings.browserNotifications} />
            <ThemeToggle />
          </div>
        </header>
        {guest && (
          <div role="note" className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-line bg-primary-soft px-4 py-2 text-center text-xs text-ink sm:px-6">
            <span>
              <strong>Guest preview.</strong> You can look at everything, but changes are turned off
              {guest.allowSearch ? ' (flight and hotel searches on the Award Calendar still work)' : ''}. This pass has {guest.loginsLeft} sign-in
              {guest.loginsLeft === 1 ? '' : 's'} left.
            </span>
            <form action={logout}>
              <button type="submit" className="underline underline-offset-2">
                Sign out
              </button>
            </form>
          </div>
        )}
        {account.settings.demoMode && (
          <div role="note" className="border-b border-line bg-gold-soft px-4 py-2 text-center text-xs text-gold sm:px-6">
            <strong>Demo data is on.</strong> Anything marked DEMO is fictional and never bookable.{' '}
            <Link href="/settings#data" className="underline underline-offset-2">
              Turn it off
            </Link>
          </div>
        )}
        <main id="main" className="mx-auto w-full max-w-6xl px-4 pt-6 pb-28 sm:px-6 lg:pb-12">
          {children}
        </main>
      </div>
      <MobileNav />
    </div>
  )
}
