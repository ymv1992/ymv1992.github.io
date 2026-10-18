'use client'

import { useMemo, useRef, useState } from 'react'

export interface HistoryPoint {
  t: string
  points: number | null
  available: boolean
  source: string
}

const W = 640
const H = 220
const PAD = { top: 16, right: 56, bottom: 28, left: 52 }

function niceStep(range: number): number {
  const raw = range / 4
  const mag = 10 ** Math.floor(Math.log10(raw || 1))
  const n = raw / mag
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag
}

const compact = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}K` : String(n))
// Explicit time zone so server and client render identical text (no hydration mismatch).
const dateFmt = (iso: string, timeZone: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone }).format(new Date(iso))

/**
 * Points price over observation time (one series). Gaps mark observations
 * with no award space. Hover/focus shows a crosshair readout; a table view
 * carries every value without hovering.
 */
export function PriceHistoryChart({ data, label, timeZone }: { data: HistoryPoint[]; label: string; timeZone: string }) {
  const [active, setActive] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const geo = useMemo(() => {
    const times = data.map((d) => Date.parse(d.t))
    const t0 = Math.min(...times)
    const t1 = Math.max(...times)
    const vals = data.filter((d) => d.points != null).map((d) => d.points!)
    const lo = vals.length ? Math.min(...vals) : 0
    const hi = vals.length ? Math.max(...vals) : 1
    const step = niceStep(Math.max(1, hi - lo))
    const yMin = Math.max(0, Math.floor((lo - step * 0.5) / step) * step)
    const yMax = Math.ceil((hi + step * 0.5) / step) * step
    const x = (t: number) => PAD.left + (t1 === t0 ? 0.5 : (t - t0) / (t1 - t0)) * (W - PAD.left - PAD.right)
    const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - PAD.top - PAD.bottom)
    const ticks: number[] = []
    for (let v = yMin; v <= yMax + 1e-9; v += step) ticks.push(v)
    // Break the line wherever space was not available.
    const segments: string[] = []
    let current = ''
    data.forEach((d, i) => {
      if (d.points == null || !d.available) {
        if (current) segments.push(current)
        current = ''
        return
      }
      current += `${current ? 'L' : 'M'}${x(times[i]!).toFixed(1)},${y(d.points).toFixed(1)}`
    })
    if (current) segments.push(current)
    const xTicks = [0, 0.5, 1].map((f) => t0 + f * (t1 - t0))
    return { times, x, y, ticks, segments, xTicks, yMin, lo, hi }
  }, [data])

  if (data.length < 2) return null
  const lastIdx = data.length - 1
  const last = data[lastIdx]!

  function nearest(clientX: number) {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const vx = ((clientX - rect.left) / rect.width) * W
    let best = 0
    let bestD = Infinity
    geo.times.forEach((t, i) => {
      const dist = Math.abs(geo.x(t) - vx)
      if (dist < bestD) {
        bestD = dist
        best = i
      }
    })
    setActive(best)
  }

  const a = active != null ? data[active] : null
  return (
    <figure>
      <figcaption className="mb-2 text-sm text-muted">{label}</figcaption>
      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full touch-none"
          role="img"
          aria-label={`${label}. ${data.length} observations; lowest ${geo.lo.toLocaleString('en-US')} points, highest ${geo.hi.toLocaleString('en-US')}. Use the left and right arrow keys to read values.`}
          tabIndex={0}
          onPointerMove={(e) => nearest(e.clientX)}
          onPointerLeave={() => setActive(null)}
          onFocus={() => setActive(lastIdx)}
          onBlur={() => setActive(null)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') setActive((i) => Math.max(0, (i ?? lastIdx) - 1))
            if (e.key === 'ArrowRight') setActive((i) => Math.min(lastIdx, (i ?? 0) + 1))
          }}
        >
          {geo.ticks.map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={W - PAD.right} y1={geo.y(v)} y2={geo.y(v)} stroke="var(--line)" strokeWidth={1} />
              <text x={PAD.left - 8} y={geo.y(v)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="var(--faint)" className="tabular">
                {compact(v)}
              </text>
            </g>
          ))}
          {geo.xTicks.map((t, i) => (
            <text key={i} x={geo.x(t)} y={H - 8} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'} fontSize={11} fill="var(--faint)">
              {dateFmt(new Date(t).toISOString(), timeZone)}
            </text>
          ))}
          {geo.segments.map((d, i) => (
            <path key={i} d={d} fill="none" stroke="var(--data)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {data.map((d, i) =>
            d.points == null || !d.available ? (
              <text key={i} x={geo.x(geo.times[i]!)} y={H - PAD.bottom - 4} textAnchor="middle" fontSize={10} fill="var(--faint)" aria-hidden>
                ×
              </text>
            ) : null,
          )}
          {last.points != null && last.available && (
            <>
              <circle cx={geo.x(geo.times[lastIdx]!)} cy={geo.y(last.points)} r={4} fill="var(--data)" stroke="var(--surface)" strokeWidth={2} />
              <text x={geo.x(geo.times[lastIdx]!) + 8} y={geo.y(last.points)} dominantBaseline="middle" fontSize={11} fill="var(--ink)" fontWeight={600} className="tabular">
                {compact(last.points)}
              </text>
            </>
          )}
          {a && active != null && (
            <g aria-hidden>
              <line x1={geo.x(geo.times[active]!)} x2={geo.x(geo.times[active]!)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--muted)" strokeWidth={1} />
              {a.points != null && a.available && <circle cx={geo.x(geo.times[active]!)} cy={geo.y(a.points)} r={4} fill="var(--data)" stroke="var(--surface)" strokeWidth={2} />}
            </g>
          )}
        </svg>
        {a && active != null && (
          <div
            className="pointer-events-none absolute top-1 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-card"
            style={{ left: `${Math.min(70, Math.max(0, (geo.x(geo.times[active]!) / W) * 100 - 10))}%` }}
            role="status"
          >
            <div className="text-sm font-semibold text-ink">{a.points != null && a.available ? `${a.points.toLocaleString('en-US')} pts` : 'No award space observed'}</div>
            <div className="text-muted">
              {dateFmt(a.t, timeZone)} · {a.source}
            </div>
          </div>
        )}
      </div>
      <p className="mt-1 text-xs text-faint">× marks checks where no award space was found.</p>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-primary">Show as table</summary>
        <table className="mt-2 w-full text-left text-xs">
          <thead className="text-faint">
            <tr>
              <th className="py-1 font-medium">Observed</th>
              <th className="py-1 font-medium">Points</th>
              <th className="py-1 font-medium">Availability</th>
              <th className="py-1 font-medium">Source</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {data.map((d, i) => (
              <tr key={i} className="border-t border-line">
                <td className="py-1">{new Date(d.t).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone })}</td>
                <td className="py-1">{d.points != null ? d.points.toLocaleString('en-US') : '—'}</td>
                <td className="py-1">{d.available ? 'Available' : 'None found'}</td>
                <td className="py-1">{d.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}
