/**
 * Research notes: long-standing program features worth checking. They are
 * general strategy, not live prices or availability, and carry a review date.
 */
export const PLAYBOOK_REVIEWED = '2026-10-18'

export const PLAYBOOK = [
  {
    id: 'hyatt-categories',
    title: 'World of Hyatt at high-cash-rate properties',
    body: 'Hyatt prices awards by property category (with off-peak, standard and peak levels), so properties whose cash rates are high relative to their category are often the most efficient. Remember the reported 4:3 transfer ratio for Sapphire Preferred and Ink Business Preferred since Oct 1, 2026.',
    action: { label: 'Open calculator', href: '/transfers?program=hyatt' },
  },
  {
    id: 'united-partners',
    title: 'Partner business class through United MileagePlus',
    body: 'United typically does not add carrier-imposed surcharges to partner awards. Compare the same Star Alliance flight in MileagePlus and Aeroplan before transferring.',
    action: { label: 'Watch a route', href: '/alerts' },
  },
  {
    id: 'aeroplan-distance',
    title: 'Aeroplan partner awards',
    body: 'Aeroplan prices partner awards by distance bands, which can favour some long routes. Some partners carry surcharges — check the taxes line before committing.',
    action: { label: 'Open calculator', href: '/transfers?program=aeroplan' },
  },
  {
    id: 'flying-blue-promo',
    title: 'Flying Blue Promo Rewards',
    body: 'Flying Blue publishes periodic discounted award routes. Treat them as leads and confirm pricing and surcharges on flyingblue.com.',
    action: { label: 'Add a lead', href: '/deals/new?program=flying_blue' },
  },
  {
    id: 'positioning-europe',
    title: 'Positioning to East Coast gateways for Europe',
    body: 'Off-peak Avios pricing on some transatlantic routes from East Coast cities can outweigh the cost of a positioning flight from California — only when separate-ticket risk and time are acceptable.',
    action: { label: 'Positioning optimizer', href: '/positioning' },
  },
  {
    id: 'fare-based',
    title: 'Fare-based programs rarely shine for luxury',
    body: 'Southwest Rapid Rewards and JetBlue TrueBlue tie points to the cash fare, so value per point stays roughly fixed. They suit inexpensive trips better than premium cabins.',
    action: { label: 'Compare in calculator', href: '/transfers?program=southwest' },
  },
] as const
