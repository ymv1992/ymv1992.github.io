import type { Metadata } from 'next'
import { loadPage } from '@/lib/server/load'
import { Roadmap } from '@/components/roadmap'
import { PageHeader } from '@/components/ui'

export const metadata: Metadata = { title: 'Millionaire Roadmap' }

export default async function RoadmapPage() {
  const { overview: o } = await loadPage()
  return (
    <>
      <PageHeader title="Millionaire Roadmap" subtitle="A model of where your portfolio could go under assumptions you control. It shows ranges and chances, never a promised return." />
      <Roadmap
        tracked={o.summary.portfolioValue}
        reported={o.profile.reportedPortfolio}
        monthly={o.profile.monthlyContribution ?? 500}
        goalTarget={o.profile.goalTarget}
        goalDate={o.profile.goalDate}
        birthYear={o.profile.birthYear}
        assumptions={o.profile.projection}
      />
    </>
  )
}
