'use client'

import { useMemo, useRef, useState } from 'react'
import { compactUsd, usd } from '@/lib/format'

export interface Series {
  key: string
  label: string
  values: number[]
  style: 'solid' | 'dashed'
}

export interface Band {
  label: string
  low: number[]
  high: number[]
  tone: 1 | 2
}

function niceMax(v: number): number {
  if (v <= 0) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / p
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 4 : n <= 8 ? 8 : 10) * p
}

/**
 * Line chart with optional shaded ranges, one shared dollar axis, a legend,
 * and a crosshair tooltip that lists every value at the hovered point.
 */
export function LineChart({ xLabels, series, bands = [], height = 300, ariaLabel }: { xLabels: string[]; series: Series[]; bands?: Band[]; height?: number; ariaLabel: string }) {
  const ref = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const W = 720
  const H = height
  const m = { top: 12, right: 16, bottom: 28, left: 54 }
  const n = xLabels.length
  const { yMax, yMin } = useMemo(() => {
    const all = [...series.flatMap((s) => s.values), ...bands.flatMap((b) => [...b.low, ...b.high])].filter(Number.isFinite)
    const lo = Math.min(...all)
    const hi = Math.max(...all)
    // Start at zero unless the data sits in a narrow range far from it.
    const base = lo > hi * 0.6 ? lo - (hi - lo) * 0.2 : 0
    return { yMax: base === 0 ? niceMax(hi) : hi + (hi - lo) * 0.1, yMin: Math.max(0, base) }
  }, [series, bands])
  const x = (i: number) => m.left + (n <= 1 ? 0 : (i / (n - 1)) * (W - m.left - m.right))
  const y = (v: number) => m.top + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - m.top - m.bottom)
  const path = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
  const area = (b: Band) => `${path(b.high)}${[...b.low].map((v, i) => [x(i), y(v)] as const).reverse().map(([px, py]) => `L${px.toFixed(1)},${py.toFixed(1)}`).join('')}Z`
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => yMin + t * (yMax - yMin))
  const xStep = Math.max(1, Math.ceil(n / 8))

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect || n < 1) return
    const px = ((e.clientX - rect.left) / rect.width) * W
    const i = Math.round(((px - m.left) / (W - m.left - m.right)) * (n - 1))
    setHover(Math.min(n - 1, Math.max(0, i)))
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <svg width="20" height="6" aria-hidden="true">
              <line x1="0" y1="3" x2="20" y2="3" stroke={s.style === 'solid' ? 'var(--gold)' : 'var(--muted)'} strokeWidth="2" strokeDasharray={s.style === 'dashed' ? '4 3' : undefined} />
            </svg>
            {s.label}
          </span>
        ))}
        {bands.map((b) => (
          <span key={b.label} className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-sm" style={{ background: `var(--band-${b.tone})` }} />
            {b.label}
          </span>
        ))}
      </div>
      <div className="relative">
        <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="w-full touch-none select-none" role="img" aria-label={ariaLabel} onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={m.left} x2={W - m.right} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth="1" />
              <text x={m.left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--faint)" className="num">
                {compactUsd(t)}
              </text>
            </g>
          ))}
          {xLabels.map((l, i) => {
            const last = i === n - 1
            // Regular ticks, plus the final point; a regular tick too close to the end gives way to it.
            if (!last && (i % xStep !== 0 || n - 1 - i < xStep / 2)) return null
            return (
              <text key={i} x={x(i)} y={H - 8} textAnchor={last ? 'end' : i === 0 ? 'start' : 'middle'} fontSize="11" fill="var(--faint)" className="num">
                {l}
              </text>
            )
          })}
          {bands.map((b) => (
            <path key={b.label} d={area(b)} fill={`var(--band-${b.tone})`} />
          ))}
          {series.map((s) => (
            <path key={s.key} d={path(s.values)} fill="none" stroke={s.style === 'solid' ? 'var(--gold)' : 'var(--muted)'} strokeWidth="2" strokeDasharray={s.style === 'dashed' ? '5 4' : undefined} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {hover != null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={m.top} y2={H - m.bottom} stroke="var(--faint)" strokeWidth="1" />
              {series.map((s) => (
                <circle key={s.key} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r="4.5" fill={s.style === 'solid' ? 'var(--gold)' : 'var(--muted)'} stroke="var(--surface)" strokeWidth="2" />
              ))}
            </g>
          )}
        </svg>
        {hover != null && (
          <div className="pointer-events-none absolute top-2 z-10 min-w-44 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-card" style={x(hover) / W > 0.55 ? { right: `${(1 - x(hover) / W) * 100 + 2}%` } : { left: `${(x(hover) / W) * 100 + 2}%` }}>
            <p className="mb-1 font-medium text-ink">{xLabels[hover]}</p>
            {series.map((s) => (
              <p key={s.key} className="flex justify-between gap-4 text-muted">
                <span>{s.label}</span>
                <span className="num text-ink">{usd(s.values[hover])}</span>
              </p>
            ))}
            {bands.map((b) => (
              <p key={b.label} className="flex justify-between gap-4 text-muted">
                <span>{b.label}</span>
                <span className="num text-ink">
                  {compactUsd(b.low[hover] ?? 0)}–{compactUsd(b.high[hover] ?? 0)}
                </span>
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
