import type { Metadata } from 'next'
import { getDb } from '@/lib/db/client'
import { loadAccount } from '@/lib/data/account'
import { requireUserId } from '@/lib/server/session'
import { OnboardingWizard } from './wizard'
import type { CardType, DateFlexibility } from '@/lib/domain/constants'

export const metadata: Metadata = { title: 'Welcome' }
export const dynamic = 'force-dynamic'

export default async function OnboardingPage() {
  const userId = await requireUserId()
  const db = await getDb()
  const { wallet, profile, settings } = await loadAccount(db, userId)
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-5 py-10">
      <OnboardingWizard
        initial={{
          cardType: wallet.cardType as CardType,
          chaseBalance: wallet.chaseBalance,
          homeAirports: profile.homeAirports,
          maxCashUsd: profile.maxCashUsd,
          tagPreferences: profile.tagPreferences as Record<string, -1 | 0 | 1 | 2>,
          tripStyles: profile.tripStyles,
          dateFlexibility: profile.dateFlexibility as DateFlexibility,
          preferredCategories: profile.preferredCategories,
          dreamDestinations: profile.dreamDestinations,
          demoMode: settings.demoMode,
        }}
      />
    </main>
  )
}
