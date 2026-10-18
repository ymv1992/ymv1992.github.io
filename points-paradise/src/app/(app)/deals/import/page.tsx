import type { Metadata } from 'next'
import { ImportForm } from '@/components/deal/import-form'
import { Card, PageHeader } from '@/components/ui'

export const metadata: Metadata = { title: 'Import deals' }

const CSV_EXAMPLE = `kind,providerName,programId,programPoints,mandatoryCashUsd,comparableCashUsd,comparableCashSource,originAirport,destAirport,destCity,travelStart,cabin,seatType,availability,sourceUrl
flight,Example Airline,united,80000,120,6200,owner_observed,LAX,NRT,Tokyo,2027-03-14,business,lie_flat,available,https://www.united.com/`

const JSON_EXAMPLE = `[
  {
    "kind": "hotel",
    "providerName": "Example Resort",
    "property": "Example Resort",
    "programId": "hyatt",
    "programPoints": 120000,
    "mandatoryCashUsd": 0,
    "comparableCashUsd": 4800,
    "destCity": "Kyoto",
    "destAirport": "KIX",
    "travelStart": "2027-04-02",
    "travelEnd": "2027-04-06",
    "roomType": "standard",
    "cashRoomType": "standard",
    "availability": "available",
    "verifiedNow": true
  }
]`

export default function ImportPage() {
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Add deals" title="Import JSON or CSV" subtitle="Each row is validated like the manual form. Rows matching an existing deal are merged as new price observations." />
      <Card className="p-5">
        <ImportForm />
      </Card>
      <Card className="p-5 text-sm">
        <h2 className="font-display text-xl">Format</h2>
        <p className="mt-1 text-muted">
          Column names match the form fields. Required: <code>kind</code>, <code>providerName</code>, <code>programId</code>, <code>destCity</code> and a destination airport or country; flights also need{' '}
          <code>cabin</code>, hotels need <code>property</code>. Program ids: aer_lingus, aeroplan, flying_blue, british_airways, iberia, jetblue, singapore, southwest, united, virgin_atlantic, hyatt, marriott, ihg,
          wyndham, chase_travel.
        </p>
        <h3 className="mt-4 font-semibold">CSV example</h3>
        <pre className="mt-1 overflow-x-auto rounded-lg bg-surface-2 p-3 text-xs">{CSV_EXAMPLE}</pre>
        <h3 className="mt-4 font-semibold">JSON example</h3>
        <pre className="mt-1 overflow-x-auto rounded-lg bg-surface-2 p-3 text-xs">{JSON_EXAMPLE}</pre>
      </Card>
    </div>
  )
}
