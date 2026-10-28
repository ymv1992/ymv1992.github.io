import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { LoginForm } from './login-form'
import { integrationStatus } from '@/lib/server/config'
import { getSessionUserId } from '@/lib/server/session'
import { SceneArt } from '@/components/scene-art'

export const metadata: Metadata = { title: 'Sign in' }

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getSessionUserId()) redirect('/discover')
  const { next } = await searchParams
  const configured = integrationStatus().auth

  return (
    <main className="grid min-h-dvh lg:grid-cols-2">
      <div className="relative hidden overflow-hidden lg:block">
        <SceneArt seed="points-paradise-login" tags={['overwater']} className="absolute inset-0 h-full w-full" />
        <div className="absolute inset-0 bg-gradient-to-t from-navy/80 via-navy/10 to-transparent" />
        <div className="absolute right-10 bottom-10 left-10 text-white">
          <p className="font-display text-4xl leading-tight">Extraordinary trips, unlocked by points used wisely.</p>
          <p className="mt-3 max-w-md text-sm text-white/80">A private Chase Ultimate Rewards travel intelligence app. Every number is sourced, every lead is labelled.</p>
        </div>
      </div>
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <p className="text-xs font-semibold tracking-[0.2em] text-gold uppercase">Private</p>
          <h1 className="font-display text-4xl">Points &amp; Paradise</h1>
          <p className="mt-2 text-sm text-muted">Sign in to your travel intelligence.</p>
          <div className="mt-8">
            {configured ? (
              <LoginForm next={next ?? ''} />
            ) : (
              <div className="rounded-2xl border border-line bg-surface p-5 text-sm">
                <p className="font-semibold">Sign-in is not configured yet</p>
                <ol className="mt-3 list-decimal space-y-2 pl-5 text-muted">
                  <li>
                    Generate a password hash: <code className="rounded bg-surface-2 px-1">npm run hash-password -- &apos;your passphrase&apos;</code>
                  </li>
                  <li>
                    Set <code className="rounded bg-surface-2 px-1">OWNER_EMAIL</code>, <code className="rounded bg-surface-2 px-1">OWNER_PASSWORD_HASH</code> and{' '}
                    <code className="rounded bg-surface-2 px-1">SESSION_SECRET</code> in your environment.
                  </li>
                  <li>Restart the app. There is no public registration.</li>
                </ol>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
