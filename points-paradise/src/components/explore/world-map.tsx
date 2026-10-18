'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { geoNaturalEarth1, geoPath } from 'd3-geo'
import { feature } from 'topojson-client'
import type { FeatureCollection, Geometry } from 'geojson'
import type { Topology } from 'topojson-specification'

export interface MapPoint {
  key: string
  city: string
  country: string
  lat: number
  lon: number
  deals: number
  bestCpp: number | null
  demoOnly: boolean
}

const W = 960
const H = 500

/**
 * World map of destinations with deals. Real deals are filled dots, demo-only
 * destinations are hollow gold rings. Hover or focus a dot for details; the
 * list below the map carries the same information without a pointer.
 */
export function WorldMap({ points }: { points: MapPoint[] }) {
  const router = useRouter()
  const [land, setLand] = useState<FeatureCollection<Geometry> | null>(null)
  const [active, setActive] = useState<MapPoint | null>(null)

  useEffect(() => {
    let alive = true
    import('world-atlas/countries-110m.json').then((mod) => {
      const topo = (mod.default ?? mod) as unknown as Topology
      if (alive) setLand(feature(topo, topo.objects.countries!) as unknown as FeatureCollection<Geometry>)
    })
    return () => {
      alive = false
    }
  }, [])

  const { path, project } = useMemo(() => {
    const projection = geoNaturalEarth1().fitExtent(
      [
        [8, 8],
        [W - 8, H - 8],
      ],
      { type: 'Sphere' },
    )
    return { path: geoPath(projection), project: (lon: number, lat: number) => projection([lon, lat]) }
  }, [])

  return (
    <figure className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`World map with ${points.length} destinations that have deals. The list below has the same information.`}>
        <path d={path({ type: 'Sphere' }) ?? ''} fill="var(--surface-2)" />
        {land?.features.map((f, i) => (
          <path key={i} d={path(f) ?? ''} fill="var(--surface)" stroke="var(--line)" strokeWidth={0.6} />
        ))}
        {points.map((p) => {
          const xy = project(p.lon, p.lat)
          if (!xy) return null
          const [x, y] = xy
          const on = active?.key === p.key
          return (
            <g
              key={p.key}
              transform={`translate(${x},${y})`}
              tabIndex={0}
              role="link"
              aria-label={`${p.city}, ${p.country}: ${p.deals} deal${p.deals === 1 ? '' : 's'}${p.bestCpp != null ? `, best ${p.bestCpp.toFixed(1)} cents per point` : ''}${p.demoOnly ? ', demo only' : ''}`}
              onMouseEnter={() => setActive(p)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(p)}
              onBlur={() => setActive(null)}
              onClick={() => router.push(`/explore?destination=${encodeURIComponent(p.city)}`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') router.push(`/explore?destination=${encodeURIComponent(p.city)}`)
              }}
              className="cursor-pointer outline-none"
            >
              <circle r={14} fill="transparent" />
              {p.demoOnly ? (
                <circle r={on ? 7 : 5} fill="var(--surface)" stroke="var(--gold)" strokeWidth={2} />
              ) : (
                <circle r={on ? 7 : 5} fill="var(--data)" stroke="var(--surface)" strokeWidth={2} />
              )}
            </g>
          )
        })}
      </svg>
      {active && (
        <div role="status" className="pointer-events-none absolute top-2 left-2 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-card">
          <div className="text-sm font-semibold">{active.bestCpp != null ? `${active.bestCpp.toFixed(2)}¢ best value` : 'Value not calculable'}</div>
          <div className="text-muted">
            {active.city}, {active.country} · {active.deals} deal{active.deals === 1 ? '' : 's'}
            {active.demoOnly ? ' · demo only' : ''}
          </div>
        </div>
      )}
      <figcaption className="mt-2 flex flex-wrap gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <svg width="12" height="12" aria-hidden>
            <circle cx="6" cy="6" r="5" fill="var(--data)" />
          </svg>
          Destinations with real deals
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="12" height="12" aria-hidden>
            <circle cx="6" cy="6" r="4" fill="none" stroke="var(--gold)" strokeWidth="2" />
          </svg>
          Demo data only
        </span>
        <span>Click a dot to see its deals.</span>
      </figcaption>
    </figure>
  )
}
