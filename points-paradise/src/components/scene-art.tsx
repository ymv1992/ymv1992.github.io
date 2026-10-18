/**
 * Generated destination artwork. Used when no licensed photo is available so
 * cards never show stock imagery that might misrepresent a specific property.
 */

type Scene = 'sea' | 'overwater' | 'mountain' | 'snow' | 'city' | 'desert' | 'savanna' | 'forest' | 'hills'

const PALETTES = [
  { sky: ['#f3d9b1', '#e7a77a', '#9c6b7d'], sun: '#fff1d6', far: '#8d7a8f', near: '#4d4a63', sea: '#6f8fa3' }, // golden hour
  { sky: ['#cfe1e6', '#9cc3c9', '#5f8f9a'], sun: '#fffaf0', far: '#7ea3a6', near: '#3f6670', sea: '#3f7f86' }, // bright day
  { sky: ['#f0c7a8', '#c9858a', '#56577a'], sun: '#ffe2c4', far: '#6d6585', near: '#33374f', sea: '#4f6688' }, // dusk
  { sky: ['#1e2c4a', '#2a3d63', '#4b5a86'], sun: '#f4ead2', far: '#2f3d5e', near: '#162036', sea: '#22345a' }, // night
  { sky: ['#e9e2d0', '#d6c7a3', '#b5a37c'], sun: '#fffdf5', far: '#a89878', near: '#6f6550', sea: '#7d8f86' }, // champagne haze
]

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function sceneFor(tags: readonly string[], kind?: string): Scene {
  const t = new Set(tags)
  if (t.has('overwater')) return 'overwater'
  if (t.has('snow')) return 'snow'
  if (t.has('safari') || t.has('wildlife')) return t.has('beach') ? 'sea' : 'savanna'
  if (t.has('beach') || t.has('island')) return 'sea'
  if (t.has('mountains')) return 'mountain'
  if (t.has('desert')) return 'desert'
  if (t.has('city')) return 'city'
  if (t.has('adventure') || t.has('scenic')) return 'forest'
  return kind === 'flight' ? 'sea' : 'hills'
}

export function SceneArt({ seed, tags, kind, className = '' }: { seed: string; tags: readonly string[]; kind?: string; className?: string }) {
  const h = hash(seed)
  const p = PALETTES[h % PALETTES.length]!
  const scene = sceneFor(tags, kind)
  const id = `g${h.toString(36)}`
  const sunX = 60 + (h % 280)
  const sunY = 70 + ((h >> 5) % 50)
  const night = p === PALETTES[3]

  return (
    <svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" className={className} role="img" aria-label="Illustration of the destination">
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p.sky[2]} />
          <stop offset="0.55" stopColor={p.sky[1]} />
          <stop offset="1" stopColor={p.sky[0]} />
        </linearGradient>
        <linearGradient id={`${id}-sea`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p.sea} stopOpacity="0.9" />
          <stop offset="1" stopColor={p.near} />
        </linearGradient>
        <radialGradient id={`${id}-sun`}>
          <stop offset="0" stopColor={p.sun} stopOpacity="1" />
          <stop offset="1" stopColor={p.sun} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="400" height="300" fill={`url(#${id}-sky)`} />
      {night &&
        Array.from({ length: 28 }, (_, i) => {
          const x = (hash(`${seed}x${i}`) % 400) + 0.5
          const y = hash(`${seed}y${i}`) % 140
          return <circle key={i} cx={x} cy={y} r={i % 5 === 0 ? 1.2 : 0.6} fill="#f6efe0" opacity={0.7} />
        })}
      <circle cx={sunX} cy={sunY} r="70" fill={`url(#${id}-sun)`} />
      <circle cx={sunX} cy={sunY} r="16" fill={p.sun} opacity="0.95" />

      {(scene === 'sea' || scene === 'overwater') && (
        <g>
          <path d="M0 190 Q 60 178 120 186 T 250 182 T 400 188 V 300 H 0 Z" fill={`url(#${id}-sea)`} />
          <path d="M0 214 Q 80 206 160 212 T 320 210 T 400 214" stroke={p.sun} strokeOpacity="0.35" fill="none" />
          <path d="M0 236 Q 90 228 180 234 T 400 236" stroke={p.sun} strokeOpacity="0.2" fill="none" />
          <path d="M250 190 Q 300 168 360 180 L 400 186 V 196 H 240 Z" fill={p.far} opacity="0.7" />
          {scene === 'overwater' ? (
            <g fill={p.near}>
              <rect x="40" y="206" width="250" height="3" />
              {[60, 120, 180, 240].map((x) => (
                <g key={x}>
                  <rect x={x - 2} y="196" width="2" height="22" />
                  <rect x={x + 22} y="196" width="2" height="22" />
                  <path d={`M${x - 8} 198 L${x + 12} 180 L${x + 32} 198 Z`} />
                  <rect x={x - 2} y="196" width="26" height="12" />
                </g>
              ))}
            </g>
          ) : (
            <g fill={p.near}>
              <path d="M78 196 C 80 160 86 140 96 120" stroke={p.near} strokeWidth="4" fill="none" />
              <path d="M96 120 q -26 -6 -40 8 q 22 -2 40 -8 z M96 120 q 22 -14 42 -6 q -22 2 -42 6 z M96 120 q -10 -22 -30 -26 q 14 12 30 26 z M96 120 q 12 -24 30 -28 q -14 14 -30 28 z" />
              <ellipse cx="70" cy="198" rx="70" ry="10" fill={p.near} opacity="0.9" />
            </g>
          )}
        </g>
      )}

      {(scene === 'mountain' || scene === 'snow') && (
        <g>
          <path d="M0 210 L70 120 L120 170 L190 90 L260 175 L320 130 L400 200 V300 H0 Z" fill={p.far} />
          {scene === 'snow' && <path d="M190 90 L172 112 L182 110 L190 120 L198 108 L208 112 Z M70 120 L58 136 L70 132 L80 138 Z" fill="#f8f5ee" opacity="0.92" />}
          <path d="M0 240 L90 180 L150 220 L230 160 L300 225 L400 190 V300 H0 Z" fill={p.near} />
          {scene === 'snow' && <rect y="262" width="400" height="38" fill="#f4efe4" opacity="0.85" />}
        </g>
      )}

      {scene === 'city' && (
        <g>
          <path d="M0 220 Q 200 200 400 220 V300 H0 Z" fill={p.far} opacity="0.6" />
          <g fill={p.near}>
            {[
              [20, 150, 30],
              [55, 120, 24],
              [84, 170, 40],
              [128, 100, 22],
              [152, 140, 34],
              [190, 80, 18],
              [212, 130, 30],
              [246, 160, 36],
              [286, 110, 26],
              [316, 150, 30],
              [350, 125, 40],
            ].map(([x, y, w]) => (
              <rect key={x} x={x} y={y} width={w} height={300 - y!} />
            ))}
            <path d="M190 80 L199 52 L208 80 Z" />
          </g>
          <g fill={p.sun} opacity="0.55">
            {Array.from({ length: 22 }, (_, i) => (
              <rect key={i} x={30 + ((i * 37) % 340)} y={170 + ((i * 23) % 90)} width="3" height="4" />
            ))}
          </g>
        </g>
      )}

      {scene === 'desert' && (
        <g>
          <path d="M0 210 Q 100 170 200 205 T 400 195 V300 H0 Z" fill={p.far} />
          <path d="M0 250 Q 120 215 240 245 T 400 240 V300 H0 Z" fill={p.near} />
        </g>
      )}

      {scene === 'savanna' && (
        <g>
          <path d="M0 220 Q 200 205 400 222 V300 H0 Z" fill={p.far} />
          <g fill={p.near}>
            <path d="M300 222 L304 170 L308 222 Z" />
            <ellipse cx="304" cy="166" rx="44" ry="9" />
            <ellipse cx="288" cy="160" rx="22" ry="6" />
            <path d="M80 222 L83 192 L86 222 Z" />
            <ellipse cx="83" cy="189" rx="24" ry="6" />
          </g>
          <path d="M0 250 Q 200 236 400 252 V300 H0 Z" fill={p.near} />
        </g>
      )}

      {(scene === 'forest' || scene === 'hills') && (
        <g>
          <path d="M0 200 Q 100 160 200 190 T 400 180 V300 H0 Z" fill={p.far} />
          {scene === 'forest' && (
            <g fill={p.near}>
              {Array.from({ length: 14 }, (_, i) => {
                const x = 10 + i * 30
                const y = 205 + ((i * 13) % 20)
                return <path key={i} d={`M${x} ${y} l12 -36 l12 36 z`} />
              })}
            </g>
          )}
          <path d="M0 240 Q 120 210 240 236 T 400 228 V300 H0 Z" fill={p.near} />
        </g>
      )}
    </svg>
  )
}
