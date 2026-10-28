import type { Metadata } from 'next'
import Link from 'next/link'
import { getViewer } from '@/lib/server/session'
import { BackButton } from '@/components/shell/back-button'
import { Card, buttonClass } from '@/components/ui'

export const metadata: Metadata = { title: 'View only' }

/** Where guest-pass visitors land when they try something that would change the owner's data. */
export default async function ViewOnlyPage() {
  const guest = (await getViewer())?.guest ?? null
  return (
    <Card className="mx-auto max-w-lg p-6 text-center">
      <p className="text-xs font-semibold tracking-[0.2em] text-gold uppercase">Guest preview</p>
      <h1 className="mt-2 font-display text-3xl">That part is view-only</h1>
      <p className="mt-3 text-sm text-muted">
        {guest
          ? 'You are signed in with a guest pass, so saving, swiping, settings, alerts and cash-price lookups are turned off. Everything else is yours to look around.'
          : 'This page is shown to guest-pass visitors when they try something that changes data.'}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <BackButton />
        <Link href="/discover" className={buttonClass('secondary')}>
          Go to Discover
        </Link>
      </div>
    </Card>
  )
}
