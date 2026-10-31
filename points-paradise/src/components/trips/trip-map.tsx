'use client'

import 'leaflet/dist/leaflet.css'
import { useEffect, useRef, useState } from 'react'
import type { LayerGroup, Map as LeafletMap } from 'leaflet'

export interface MapCity {
  key: string
  city: string
  /** "Days 1–3", or "Ideas only". */
  when: string
}

export interface MapPin {
  id: string
  cityKey: string
  lat: number
  lng: number
  title: string
  day: number | null
  time: string | null
}

const pinLabel = (p: MapPin) => (p.day == null ? '★' : String(p.day))
const order = (a: MapPin, b: MapPin) => (a.day ?? 999) - (b.day ?? 999) || (a.time ?? '99').localeCompare(b.time ?? '99')

/** Google Maps directions between two pins (no key needed). */
function directionsUrl(from: MapPin, to: MapPin): string {
  return `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}`
}

/**
 * One map per city on the trip, with every planned place as a numbered pin
 * (the number is the trip day; ★ is an idea). OpenStreetMap tiles, no key.
 */
export function TripMap({ cities, pins }: { cities: MapCity[]; pins: MapPin[] }) {
  const [active, setActive] = useState(cities[0]?.key ?? '')
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<LeafletMap | null>(null)
  const layer = useRef<LayerGroup | null>(null)
  const shown = pins.filter((p) => p.cityKey === active).sort(order)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const L = (await import('leaflet')).default
      if (cancelled || !box.current) return
      if (!map.current) {
        map.current = L.map(box.current, { scrollWheelZoom: false })
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(map.current)
        layer.current = L.layerGroup().addTo(map.current)
      }
      layer.current!.clearLayers()
      const points: [number, number][] = []
      for (const p of shown) {
        const popup = document.createElement('div')
        const strong = document.createElement('strong')
        strong.textContent = p.title
        popup.append(strong, document.createElement('br'), document.createTextNode([p.day == null ? 'Idea' : `Day ${p.day}`, p.time].filter(Boolean).join(' · ')))
        L.marker([p.lat, p.lng], {
          title: p.title,
          icon: L.divIcon({ className: '', html: `<span class="trip-pin${p.day == null ? ' trip-pin-idea' : ''}">${pinLabel(p)}</span>`, iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -12] }),
        })
          .bindPopup(popup)
          .addTo(layer.current!)
        points.push([p.lat, p.lng])
      }
      if (points.length === 1) map.current.setView(points[0]!, 14)
      else if (points.length) map.current.fitBounds(points, { padding: [32, 32], maxZoom: 15 })
    })()
    return () => {
      cancelled = true
    }
    // Redraw when the city or the pins change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, pins])

  useEffect(
    () => () => {
      map.current?.remove()
      map.current = null
    },
    [],
  )

  if (!cities.length) return null
  return (
    <div>
      {cities.length > 1 && (
        <div role="tablist" aria-label="Cities" className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {cities.map((c) => (
            <button
              key={c.key}
              type="button"
              role="tab"
              aria-selected={c.key === active}
              onClick={() => setActive(c.key)}
              className={`shrink-0 rounded-xl border px-3 py-1.5 text-left text-sm ${c.key === active ? 'border-primary bg-primary text-primary-ink' : 'border-line bg-surface hover:bg-surface-2'}`}
            >
              <span className="font-semibold">{c.city}</span>
              <span className={`block text-xs ${c.key === active ? 'opacity-90' : 'text-muted'}`}>{c.when}</span>
            </button>
          ))}
        </div>
      )}
      <div ref={box} className="relative z-0 h-72 w-full overflow-hidden rounded-xl border border-line sm:h-96" aria-label={`Map of ${cities.find((c) => c.key === active)?.city ?? ''}`} role="region" />
      {shown.length > 0 ? (
        <ol className="mt-3 space-y-1.5 text-sm">
          {shown.map((p, i) => {
            const prev = shown[i - 1]
            const sameDay = prev && prev.day === p.day && p.day != null
            return (
              <li key={p.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className={`trip-pin trip-pin-sm ${p.day == null ? 'trip-pin-idea' : ''}`} aria-hidden>
                  {pinLabel(p)}
                </span>
                <span className="text-muted">{[p.day == null ? 'Idea' : `Day ${p.day}`, p.time].filter(Boolean).join(' · ')}</span>
                <span className="font-medium">{p.title}</span>
                {sameDay && (
                  <a href={directionsUrl(prev!, p)} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">
                    Directions from {prev!.title} ↗
                  </a>
                )}
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="mt-3 text-sm text-muted">Nothing pinned in this city yet.</p>
      )}
    </div>
  )
}
