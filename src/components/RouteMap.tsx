import { COLS, ROWS, COAST, LAKE, PARKS, HIGHWAY, MAP_W, MAP_H, type Route } from '../data/detail'
import { time } from '../lib/format'

const STREETS_V = ['Harbor Ave', '2nd St', 'Pine St', 'Mercer', 'Division', 'Ruston Way', 'Canal St', 'Hwy 99', '']
const STREETS_H = ['N 38th St', 'Commerce', 'Pacific Ave', 'Portland Ave', 'S 56th St', 'Valley Rd', '']

export function RouteMap({ route, decor = false, className = '' }: { route?: Route; decor?: boolean; className?: string }) {
  const pts = (p: [number, number][]) => p.map((q) => q.join(',')).join(' ')
  return (
    <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className={`block w-full h-auto ${className}`} role="img" aria-label={decor ? 'Decorative schematic map' : 'Schematic map of today’s route'}>
      <rect width={MAP_W} height={MAP_H} className="fill-sunk" />
      {/* blocks */}
      <g className="fill-surface">
        {COLS.slice(0, -1).map((x, i) => ROWS.slice(0, -1).map((y, j) => (
          <rect key={`${i}-${j}`} x={x + 7} y={y + 7} width={COLS[i + 1] - x - 14} height={ROWS[j + 1] - y - 14} rx="2" />
        )))}
      </g>
      {PARKS.map((d) => <path key={d} d={d} className="fill-[#E1E5CF] dark:fill-[#262A1C]" />)}
      <path d={LAKE} className="fill-[#D6DFDC] dark:fill-[#1D2523]" />
      <path d={COAST} className="fill-[#D6DFDC] dark:fill-[#1D2523]" />
      <path d={COAST} fill="none" className="stroke-[#B9C6C2] dark:stroke-[#2C3634]" strokeWidth="1" />
      <path d={HIGHWAY} fill="none" className="stroke-line-strong" strokeWidth="9" strokeLinecap="round" />
      <path d={HIGHWAY} fill="none" className="stroke-surface" strokeWidth="5" strokeLinecap="round" />
      {!decor && (
        <g className="fill-ink-3" style={{ fontSize: 9, letterSpacing: '0.06em', fontWeight: 600 }}>
          {STREETS_V.map((s, i) => s && <text key={s} x={COLS[i] + 4} y={ROWS[5] + 34} transform={`rotate(-90 ${COLS[i] + 4} ${ROWS[5] + 34})`} textAnchor="start">{s.toUpperCase()}</text>)}
          {STREETS_H.map((s, j) => s && <text key={s} x={COLS[0] + 12} y={ROWS[j] - 3}>{s.toUpperCase()}</text>)}
          <text x="36" y="250" className="fill-[#8FA39E] dark:fill-[#4A5A56]" style={{ fontSize: 11, fontStyle: 'italic', letterSpacing: '0.2em' }}>SOUND</text>
          <g transform="translate(470 250)"><rect x="-17" y="-8" width="34" height="16" rx="3" className="fill-surface stroke-line-strong" /><text textAnchor="middle" y="3.5" className="fill-ink-2" style={{ fontSize: 9 }}>I-5</text></g>
        </g>
      )}

      {route && (
        <g>
          <polyline points={pts(route.path)} fill="none" className="stroke-ink-3" strokeWidth="2.5" strokeDasharray="2 5" strokeLinecap="round" strokeLinejoin="round" />
          <polyline points={pts(route.driven)} fill="none" className="stroke-surface" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
          <polyline points={pts(route.driven)} fill="none" className="stroke-ink" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          {route.stops.map((s, i) => {
            const reached = route.driven.some((p) => p[0] === s.pt[0] && p[1] === s.pt[1])
            return (
              <g key={i} transform={`translate(${s.pt[0]} ${s.pt[1]})`}>
                {s.kind === 'depot' ? (
                  <rect x="-9" y="-9" width="18" height="18" rx="2" className="fill-ink" />
                ) : (
                  <circle r="9.5" className={reached ? 'fill-ink' : 'fill-surface stroke-ink'} strokeWidth="2" />
                )}
                <text textAnchor="middle" y="3.6" className={s.kind === 'depot' || reached ? 'fill-bg' : 'fill-ink'} style={{ fontSize: 10, fontWeight: 700 }}>
                  {s.kind === 'depot' ? 'D' : s.kind === 'fuel' ? 'F' : i}
                </text>
                {!decor && (
                  <text x="14" y="-8" className="fill-ink-2 stroke-surface" strokeWidth="3.5" strokeLinejoin="round" style={{ fontSize: 9.5, fontWeight: 600, paintOrder: 'stroke' }}>
                    <tspan className="fill-ink">{s.label.length > 22 ? s.label.slice(0, 21) + '…' : s.label}</tspan>
                    <tspan x="14" dy="11" className="fill-ink-3" style={{ fontFamily: 'JetBrains Mono Variable, monospace', fontWeight: 500 }}>{time(s.arrive)}</tspan>
                  </text>
                )}
              </g>
            )
          })}
          {route.current && (
            <g transform={`translate(${route.current[0]} ${route.current[1]})`}>
              <circle r="7" className="fill-signal ping" />
              <circle r="8" className="fill-signal stroke-ink" strokeWidth="2.5" />
            </g>
          )}
        </g>
      )}
      {!decor && (
        <g transform={`translate(${MAP_W - 110} ${MAP_H - 22})`} className="fill-ink-2" style={{ fontSize: 9, fontFamily: 'JetBrains Mono Variable, monospace' }}>
          <rect width="80" height="4" className="fill-ink" /><rect width="40" height="4" className="fill-ink-3" />
          <text y="-5">0</text><text x="36" y="-5">1</text><text x="72" y="-5">2 mi</text>
        </g>
      )}
    </svg>
  )
}
