import type { IconName } from '../icons'

export interface NavItem {
  href: string
  label: string
  icon: IconName
  /** Shown in the mobile bottom bar. */
  primary?: boolean
}

export const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Discover',
    items: [
      { href: '/discover', label: 'Discover', icon: 'compass', primary: true },
      { href: '/top', label: 'Top 100', icon: 'trophy', primary: true },
      { href: '/categories', label: 'Categories', icon: 'grid' },
      { href: '/explore', label: 'Explore', icon: 'globe', primary: true },
      { href: '/calendar', label: 'Award Calendar', icon: 'calendar' },
    ],
  },
  {
    title: 'Plan',
    items: [
      { href: '/saved', label: 'Saved', icon: 'bookmark', primary: true },
      { href: '/trips', label: 'My Trips', icon: 'suitcase' },
      { href: '/trip-architect', label: 'Trip Architect', icon: 'sparkles' },
      { href: '/transfers', label: 'Transfer Center', icon: 'transfer' },
      { href: '/positioning', label: 'Positioning', icon: 'plane' },
    ],
  },
  {
    title: 'Track',
    items: [
      { href: '/alerts', label: 'Alerts', icon: 'bell' },
      { href: '/history', label: 'History', icon: 'clock' },
      { href: '/deals/new', label: 'Add a deal', icon: 'plus' },
      { href: '/settings', label: 'Settings', icon: 'settings' },
    ],
  },
]

export const MOBILE_NAV: NavItem[] = [
  { href: '/discover', label: 'Discover', icon: 'compass' },
  { href: '/top', label: 'Rankings', icon: 'trophy' },
  { href: '/saved', label: 'Saved', icon: 'bookmark' },
  { href: '/explore', label: 'Explore', icon: 'globe' },
  { href: '/me', label: 'Profile', icon: 'user' },
]
