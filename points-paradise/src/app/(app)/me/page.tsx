import type { Metadata } from 'next'
import Link from 'next/link'
import { cardLabel, type CardType } from '@/lib/domain/constants'
import { points, usd } from '@/lib/format'
import { getEvaluation } from '@/lib/server/loaders'
import { Icon, type IconName } from '@/components/icons'
import { Card, PageHeader, Stat } from '@/components/ui'

export const metadata: Metadata = { title: 'Profile' }

const LINKS: { href: string; label: string; icon: IconName; hint: string }[] = [
  { href: '/trips', label: 'My Trips', icon: 'suitcase', hint: 'Day-by-day plans you can rearrange, tick off and share' },
  { href: '/trip-architect', label: 'Trip Architect', icon: 'sparkles', hint: 'Assemble complete trips within your budget' },
  { href: '/transfers', label: 'Transfer Center', icon: 'transfer', hint: 'Partners, ratios, bonuses and the calculator' },
  { href: '/calendar', label: 'Award Calendar', icon: 'calendar', hint: 'Flexible dates and price history' },
  { href: '/positioning', label: 'Positioning optimizer', icon: 'plane', hint: 'Is another departure airport worth it?' },
  { href: '/categories', label: 'Category leaderboards', icon: 'grid', hint: 'Business, first, resorts, weekend…' },
  { href: '/alerts', label: 'Alerts', icon: 'bell', hint: 'Notifications, watches and alert criteria' },
  { href: '/history', label: 'History', icon: 'clock', hint: 'Missed deals, passed deals, price changes' },
  { href: '/deals/new', label: 'Add a deal', icon: 'plus', hint: 'Enter or import a deal you found' },
  { href: '/settings', label: 'Settings', icon: 'settings', hint: 'Wallet, travel profile, data sources, privacy' },
]

export default async function MePage() {
  const data = await getEvaluation()
  const { wallet, profile } = data.account
  return (
    <div>
      <PageHeader eyebrow="Profile" title={profile.name} subtitle={`${cardLabel(wallet.cardType as CardType)} · flying from ${profile.homeAirports.join(', ')}`} />
      <Card className="mb-6 grid grid-cols-3 gap-4 p-5">
        <Stat label="Chase points" value={points(wallet.chaseBalance)} />
        <Stat label="Cash budget" value={usd(profile.maxCashUsd)} />
        <Stat label="Saved deals" value={data.savedIds.size} />
      </Card>
      <ul className="grid gap-2 sm:grid-cols-2">
        {LINKS.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 hover:border-primary">
              <span className="flex size-10 items-center justify-center rounded-full bg-primary-soft text-primary">
                <Icon name={l.icon} />
              </span>
              <span>
                <span className="block font-semibold">{l.label}</span>
                <span className="block text-xs text-muted">{l.hint}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
