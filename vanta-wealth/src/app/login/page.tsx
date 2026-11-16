import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { LoginForm, SetupForm } from './forms'
import { integrationStatus } from '@/lib/server/config'
import { getSessionUserId } from '@/lib/server/session'

export const metadata: Metadata = { title: 'Sign in' }
export const dynamic = 'force-dynamic'

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const status = integrationStatus()
  if (status.auth && (await getSessionUserId().catch(() => null))) redirect('/')
  const { next } = await searchParams

  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <p className="eyebrow !text-gold">Private</p>
        <h1 className="font-display text-5xl tracking-tight">Vanta Wealth</h1>
        <div className="hairline my-5" />
        <p className="text-sm text-muted">Turn financial information into informed decisions, and informed decisions into long-term wealth.</p>
        <div className="mt-8">
          {status.auth ? (
            <LoginForm next={next ?? ''} />
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-line bg-surface p-4 text-sm text-muted">
                <p className="font-medium text-ink">First-time setup</p>
                <p className="mt-1">
                  Sign-in is not configured yet. Choose a passphrase below, then add <code className="num text-xs text-ink">OWNER_EMAIL</code>, <code className="num text-xs text-ink">OWNER_PASSWORD_HASH</code> and{' '}
                  <code className="num text-xs text-ink">SESSION_SECRET</code> to your hosting settings. There is no public registration.
                </p>
              </div>
              <SetupForm />
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
