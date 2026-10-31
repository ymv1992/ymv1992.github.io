import type { TripWeather } from '@/lib/data/trip-weather'
import type { TripPlan } from '@/lib/data/trip-insights'
import { Badge } from '../ui'

function dayLabel(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

const deg = (v: number | null) => (v == null ? '–' : `${Math.round(v)}°`)

/** Weather for each upcoming day, in the city the trip is in that day. */
export function TripWeatherView({ weather, plan, hasDates, today }: { weather: TripWeather | null; plan: TripPlan; hasDates: boolean; today: string }) {
  if (!hasDates) return <p className="text-sm text-muted">Add the trip&rsquo;s dates to see the weather for each day.</p>
  const upcoming = plan.dayCities.filter((d) => d.date && d.date >= today)
  if (!upcoming.length) return <p className="text-sm text-muted">This trip is over, so there&rsquo;s no forecast.</p>
  const unknown = upcoming.filter((d) => !d.cityKey)
  const byDay = new Map((weather?.days ?? []).map((w) => [w.day, w]))
  const rows = upcoming.filter((d) => byDay.has(d.day))
  const anyTypical = rows.some((d) => byDay.get(d.day)!.kind === 'typical')
  return (
    <div>
      {rows.length > 0 && (
        <ul className="divide-y divide-line text-sm">
          {rows.map((d) => {
            const w = byDay.get(d.day)!
            return (
              <li key={d.day} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5">
                <span>
                  <span className="font-medium">{dayLabel(d.date!)}</span> <span className="text-muted">· Day {d.day} · {w.city}</span>
                </span>
                <span className="tabular flex items-center gap-2">
                  <span>{w.label}</span>
                  <span className="font-semibold">
                    {deg(w.hi)} <span className="font-normal text-muted">/ {deg(w.lo)}F</span>
                  </span>
                  {w.rainChance != null && w.rainChance >= 20 && <span className="text-xs text-primary">{w.rainChance}% rain</span>}
                  {w.kind === 'typical' && <Badge tone="neutral">Typical</Badge>}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {anyTypical && (
        <p className="mt-2 text-xs text-muted">
          &ldquo;Typical&rdquo; days are the average of the same dates over the last {weather?.years ?? 3} years, and rain is how often it rained then. The real forecast appears 16 days before.
        </p>
      )}
      {weather && weather.unavailable.length > 0 && <p className="mt-2 text-xs text-warn">Weather for {weather.unavailable.join(', ')} isn&rsquo;t available right now. Try again later.</p>}
      {unknown.length > 0 && (
        <p className="mt-2 text-xs text-muted">
          {unknown.length === upcoming.length ? 'Add places (or a hotel) to your plans' : `Add places to Day ${unknown.map((d) => d.day).join(', ')}`} so the trip knows which city you&rsquo;re in, then tap &ldquo;Find maps &amp; photos&rdquo;
          if it shows.
        </p>
      )}
      <p className="mt-2 text-[11px] text-faint">
        Weather by{' '}
        <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer" className="underline">
          Open-Meteo.com
        </a>
        .
      </p>
    </div>
  )
}
