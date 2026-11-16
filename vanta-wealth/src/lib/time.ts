/** Date helpers. Calendar days follow US Eastern time, the market's clock, so an evening entry is not dated tomorrow. */
export function isoDay(offsetDays = 0, now = new Date()): string {
  const d = new Date(now.getTime() + offsetDays * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}
