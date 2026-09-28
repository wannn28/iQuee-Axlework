import { useApp } from '../store/app'

export function useChartColors() {
  const { theme } = useApp()
  const dark = theme === 'dark'
  return {
    dark,
    ink: dark ? '#EDEAE1' : '#181714',
    ink2: dark ? '#ADA89C' : '#545048',
    ink3: dark ? '#7A766D' : '#847F74',
    grid: dark ? '#32302C' : '#E2DED3',
    surface: dark ? '#1E1D1A' : '#FFFEFB',
    signal: '#F2BE22',
    ok: dark ? '#58BA80' : '#247A4C',
    warn: dark ? '#EC923C' : '#C7660C',
    crit: dark ? '#EE6254' : '#C43226',
    muted: dark ? '#4E4B44' : '#C7C1B3',
  }
}

interface TipProps {
  active?: boolean
  label?: string | number
  payload?: { name?: string; value?: number | string; color?: string; dataKey?: string | number }[]
  labelFmt?: (l: string) => string
  valueFmt?: (v: number, key: string) => string
}
export function ChartTip({ active, payload, label, labelFmt, valueFmt }: TipProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-[5px] border border-line-strong bg-surface px-3 py-2 shadow-[0_6px_20px_-8px_rgba(0,0,0,.25)] text-xs">
      {label != null && <div className="label mb-1">{labelFmt ? labelFmt(String(label)) : label}</div>}
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2 py-0.5">
          <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />
          <span className="text-ink-2">{p.name}</span>
          <span className="num ml-auto pl-4 font-semibold">{valueFmt ? valueFmt(Number(p.value), String(p.dataKey)) : p.value}</span>
        </div>
      ))}
    </div>
  )
}
