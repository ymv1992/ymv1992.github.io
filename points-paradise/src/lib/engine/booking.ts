import { CABIN_LABELS, ROOM_TYPE_LABELS } from '../domain/constants'
import type { Deal, TransferPartner } from '../domain/types'
import { formatRatio } from './transfer'
import type { Valuation } from './valuation'

export interface ChecklistStep {
  id: string
  title: string
  detail: string
  link?: { label: string; url: string }
  warning?: boolean
}

/** The only Chase URL we link to: the public homepage, from which the owner signs in. */
export const CHASE_HOME_URL = 'https://www.chase.com/'

function money(n: number | null | undefined): string {
  return n == null ? 'unknown' : `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}

/**
 * Step-by-step guide for booking independently. The app never transfers
 * points, books or pays, and only links to known official homepages or URLs
 * supplied by a data source.
 */
export function bookingChecklist(deal: Deal, valuation: Valuation, partner: TransferPartner | null): ChecklistStep[] {
  const steps: ChecklistStep[] = []
  const programName = partner?.programName ?? (deal.programId === 'chase_travel' ? 'Chase Travel' : (deal.programId ?? 'the loyalty program'))
  const officialUrl = deal.bookingUrl ?? partner?.programUrl ?? null
  const params: string[] = []
  if (deal.hotel) {
    params.push(`for ${deal.hotel.property}`)
    if (deal.travelStart) params.push(`check-in ${deal.travelStart}`)
    if (deal.travelEnd) params.push(`check-out ${deal.travelEnd}`)
    if (deal.hotel.guests) params.push(`${deal.hotel.guests} guest${deal.hotel.guests > 1 ? 's' : ''}`)
  } else {
    if (deal.originAirport) params.push(`from ${deal.originAirport}`)
    if (deal.destination.airport) params.push(`to ${deal.destination.airport}`)
    if (deal.travelStart) params.push(`on ${deal.travelStart}${deal.flexibleDates && deal.travelEnd ? ` (flexible to ${deal.travelEnd})` : ''}`)
    if (deal.flight) params.push(`in ${CABIN_LABELS[deal.flight.cabin]}`)
  }

  steps.push({
    id: 'confirm-availability',
    title: `Confirm award availability on ${programName}`,
    detail: `Search ${params.join(' ')}. Award space shown here may have changed since it was last checked.`,
    link: officialUrl ? { label: `Open ${programName}`, url: officialUrl } : undefined,
  })

  if (deal.kind === 'flight' && deal.flight) {
    const f = deal.flight
    steps.push({
      id: 'verify-flight',
      title: 'Verify flight number and aircraft',
      detail: `Expected ${f.flightNumbers.length ? f.flightNumbers.join(', ') : 'flight numbers not recorded'}${f.aircraft ? ` on ${f.aircraft}` : ''}. Aircraft swaps happen — check the seat map before transferring.`,
    })
    steps.push({
      id: 'verify-seat',
      title: 'Confirm the seat is what you expect',
      detail:
        f.cabin === 'business' || f.cabin === 'first'
          ? 'Check whether the premium seat is lie-flat or a recliner, and whether every segment is in the premium cabin (mixed-cabin itineraries are common).'
          : 'Check seat assignments and baggage allowance.',
      warning: f.seatType === 'unknown' && (f.cabin === 'business' || f.cabin === 'first'),
    })
  }
  if (deal.kind === 'hotel' && deal.hotel) {
    const h = deal.hotel
    steps.push({
      id: 'verify-room',
      title: 'Confirm the exact room category',
      detail: `The award should be for: ${h.roomCategory ?? ROOM_TYPE_LABELS[h.roomType]}. Standard-room awards are not villas or suites unless the booking page says so.`,
      warning: h.roomType === 'unknown',
    })
    if (h.mandatoryTransfer || h.resortFeeUsd) {
      steps.push({
        id: 'verify-fees',
        title: 'Check mandatory fees and transfers',
        detail: [h.resortFeeUsd ? `Resort fee ${money(h.resortFeeUsd)}` : null, h.mandatoryTransfer ? `Transfer: ${h.mandatoryTransfer}` : null]
          .filter(Boolean)
          .join(' · '),
      })
    }
  }
  steps.push({
    id: 'taxes',
    title: 'Check total taxes and fees',
    detail: `Recorded mandatory cash: ${money(deal.mandatoryCashUsd)}. Fuel surcharges and resort fees can change.`,
  })

  const t = valuation.transfer
  if (t && !t.isChaseTravel) {
    steps.push({
      id: 'confirm-ratio',
      title: 'Confirm the transfer ratio and any bonus',
      detail: `Expected ratio ${t.ratio ? formatRatio(t.ratio) : 'unknown'}${t.bonusPercent ? ` with a ${t.bonusPercent}% bonus${t.bonusSource === 'illustrative' ? ' (illustrative demo value — not real)' : ''}` : ''}. Ratios can differ by card.`,
      warning: t.bonusSource === 'illustrative',
    })
    steps.push({
      id: 'points',
      title: `Transfer ${t.requirement.chasePoints.toLocaleString('en-US')} Chase points`,
      detail: `You will receive ${t.requirement.partnerReceived.toLocaleString('en-US')} ${programName} points${t.requirement.bonusPartnerPoints ? ` (incl. ${t.requirement.bonusPartnerPoints.toLocaleString('en-US')} bonus)` : ''}. Transfers are typically irreversible.`,
      warning: true,
    })
    steps.push({
      id: 'link-accounts',
      title: 'Make sure your loyalty account is linked',
      detail: `The name on your ${programName} account must match your Chase account. Processing time: ${t.processingTime ?? 'unknown'}.`,
    })
    steps.push({
      id: 'open-chase',
      title: 'Open Chase Ultimate Rewards and transfer',
      detail: 'Sign in, open Ultimate Rewards, choose "Transfer to Travel Partners", and select the program. Only transfer once you have confirmed availability.',
      link: { label: 'Open chase.com', url: CHASE_HOME_URL },
    })
  } else if (t?.isChaseTravel) {
    steps.push({
      id: 'chase-travel',
      title: 'Book through Chase Travel',
      detail: `Sign in to chase.com, open Chase Travel and search the same itinerary. Points shown: ${t.requirement.chasePoints.toLocaleString('en-US')}.`,
      link: { label: 'Open chase.com', url: CHASE_HOME_URL },
    })
  }
  steps.push({
    id: 'book',
    title: `Book on ${programName}`,
    detail: officialUrl
      ? 'Return to the program site, search again with the same parameters and complete the booking with your new points.'
      : `No direct booking link is known. Go to the official ${programName} site and search: ${params.join(' ')}.`,
    link: officialUrl ? { label: `Open ${programName}`, url: officialUrl } : undefined,
  })
  steps.push({
    id: 'save-confirmation',
    title: 'Save your confirmation',
    detail: 'Save the confirmation number and e-ticket/receipt, then mark the deal as booked here so it informs future recommendations.',
  })
  return steps
}
