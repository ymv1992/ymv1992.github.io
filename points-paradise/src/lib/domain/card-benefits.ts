/**
 * What each Chase card earns and includes, for the Profile page. Compiled from
 * public reporting (the newsroom, card reviews and points blogs) and checked
 * automatically every week; the date and sources are shown with it. These are
 * reported benefits: confirm in your Chase account before relying on one.
 */
import type { CardType } from './constants'

/** When this list was last checked against public reporting (YYYY-MM-DD). */
export const BENEFITS_CHECKED = '2026-11-08'

export interface CardBenefits {
  annualFeeUsd: number | null
  /** Points per dollar by category, highest first. */
  earning: { rate: string; what: string; isNew?: boolean }[]
  /** Statement credits and perks. */
  perks: { what: string; isNew?: boolean }[]
  /** How transfers to partners differ for this card. */
  transfers: string[]
  sources: { label: string; url: string }[]
}

const SOURCES = {
  forbesPreferred: { label: 'Forbes: Sapphire Preferred 2026 updates', url: 'https://www.forbes.com/advisor/credit-cards/chase-sapphire-preferred-updates-and-impact/' },
  nerdwalletPreferred: { label: 'NerdWallet: Sapphire Preferred benefits', url: 'https://www.nerdwallet.com/credit-cards/learn/benefits-chase-sapphire-preferred' },
  chaseNewsPreferred: { label: 'Chase newsroom: the new Sapphire Preferred', url: 'https://media.chase.com/news/Meet-the-New-Chase-Sapphire-Preferred' },
  hyatt: { label: 'The Points Guy: Hyatt transfer ratio change', url: 'https://thepointsguy.com/news/chase-hyatt-transfer-ratio-change/' },
  reserveCredits: { label: 'View from the Wing: Sapphire Reserve hotel and Edit credits', url: 'https://viewfromthewing.com/chase-sapphire-reserve-changed-again-new-250-hotel-credit-and-more-flexible-500-edit-credit/' },
  reserveReview: { label: 'point.me: Sapphire Reserve 2026 changes', url: 'https://www.point.me/c/insights/chase-sapphire-reserve/' },
  reserveBusiness: { label: 'AwardWallet: Sapphire Reserve for Business changes', url: 'https://awardwallet.com/news/chase-ultimate-rewards/sapphire-reserve-business-card-changes' },
} as const

const RESERVE_EARNING: CardBenefits['earning'] = [
  { rate: '8×', what: 'Chase Travel purchases (flights, hotels, cars and more)' },
  { rate: '4×', what: 'Flights and hotels booked directly with the airline or hotel' },
  { rate: '3×', what: 'Dining' },
  { rate: '1×', what: 'Everything else' },
]

export const CARD_BENEFITS: Partial<Record<CardType, CardBenefits>> = {
  sapphire_preferred: {
    annualFeeUsd: 95,
    earning: [
      { rate: '5×', what: 'Chase Travel purchases (flights, hotels, cars, vacation homes, cruises, activities)' },
      { rate: '3×', what: 'Dining, including eligible delivery and takeout' },
      { rate: '3×', what: 'Gas and EV charging', isNew: true },
      { rate: '3×', what: 'Select streaming' },
      { rate: '3×', what: 'Online groceries (not Walmart, Target or wholesale clubs)' },
      { rate: '2×', what: 'Other travel, including flights and hotels booked directly' },
      { rate: '1×', what: 'Everything else' },
    ],
    perks: [
      { what: 'Up to $100 a year for hotels booked through Chase Travel (doubled from $50)', isNew: true },
      { what: 'Up to $120 statement credit for Global Entry, TSA PreCheck or NEXUS', isNew: true },
      { what: 'Apple TV free for a year when activated by December 31, 2026', isNew: true },
      { what: 'Trip delay, trip cancellation and baggage delay coverage when you pay with the card' },
    ],
    transfers: ['World of Hyatt is 4:3 (1,000 Chase points → 750 Hyatt points) since October 1, 2026. Other partners stay 1:1.'],
    sources: [SOURCES.chaseNewsPreferred, SOURCES.forbesPreferred, SOURCES.nerdwalletPreferred, SOURCES.hyatt],
  },
  sapphire_reserve: {
    annualFeeUsd: 795,
    earning: RESERVE_EARNING,
    perks: [
      { what: '$300 annual travel credit' },
      { what: 'Up to $500 a year for hotels in The Edit by Chase Travel (made easier to use in 2026)', isNew: true },
      { what: 'Up to $250 for select Chase Travel hotels', isNew: true },
      { what: 'Airport lounges: Priority Pass and Chase Sapphire Lounges' },
    ],
    transfers: ['World of Hyatt stays 1:1 on Reserve cards.'],
    sources: [SOURCES.reserveCredits, SOURCES.reserveReview, SOURCES.hyatt],
  },
  sapphire_reserve_business: {
    annualFeeUsd: 795,
    earning: [
      ...RESERVE_EARNING.slice(0, 3),
      { rate: '3×', what: 'Social media and search advertising (first $1 million a year from November 15, 2026)', isNew: true },
      RESERVE_EARNING[3]!,
    ],
    perks: [{ what: '$300 annual travel credit' }, { what: 'Airport lounges: Priority Pass and Chase Sapphire Lounges' }],
    transfers: ['World of Hyatt stays 1:1 on Reserve cards.'],
    sources: [SOURCES.reserveBusiness, SOURCES.hyatt],
  },
}
