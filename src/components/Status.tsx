import { STATUS_LABEL, type Status } from '../data/fleet'

export const STATUS_DOT: Record<Status, string> = {
  moving: 'bg-ok', idle: 'bg-signal', parked: 'bg-ink-3', maintenance: 'bg-warn', offline: 'bg-crit',
}
export function StatusBadge({ s }: { s: Status }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium whitespace-nowrap">
      <span className={`h-2 w-2 rounded-full ${STATUS_DOT[s]} ${s === 'moving' ? 'ring-[3px] ring-ok/20' : ''}`} />
      {STATUS_LABEL[s]}
    </span>
  )
}
export function Severity({ s }: { s: 'critical' | 'warning' | 'info' }) {
  const cls = s === 'critical' ? 'bg-crit text-white' : s === 'warning' ? 'bg-signal text-[#181714]' : 'bg-sunk text-ink-2 border border-line'
  return <span className={`inline-flex h-[18px] w-10 items-center justify-center rounded-[3px] text-[10px] font-bold uppercase tracking-wide ${cls}`}>{s === 'critical' ? 'Crit' : s === 'warning' ? 'Warn' : 'Info'}</span>
}
export function FuelBar({ v, sensor = true }: { v: number; sensor?: boolean }) {
  if (!sensor) return <span className="text-ink-3 text-xs">no sensor</span>
  const color = v < 15 ? 'bg-crit' : v < 30 ? 'bg-warn' : 'bg-ink'
  return (
    <span className="flex items-center gap-2">
      <span className="relative h-1.5 w-14 rounded-full bg-sunk overflow-hidden border border-line">
        <span className={`absolute inset-y-0 left-0 ${color}`} style={{ width: `${v}%` }} />
      </span>
      <span className="num text-xs w-8 text-right">{v}%</span>
    </span>
  )
}
