import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, LabelList } from 'recharts'
import { useApp } from '../store/app'
import { STATUS_LABEL, ALERT_LABEL, type Status, type FleetAlert } from '../data/fleet'
import { useChartColors, ChartTip } from '../components/chart'
import { Severity, STATUS_DOT } from '../components/Status'
import { usd, num, compact, dist, distUnit, vol, volUnit, eff, effUnit, ago, day } from '../lib/format'
import { api, download, qs, useApi } from '../lib/api'
import { ErrorPanel, LoadingPanel, Spinner } from '../components/States'
import { useTitle } from '../lib/useTitle'
import { IDownload, ICheck, IUp, IDown } from '../components/Icons'

const RANGES = [7, 30, 90] as const
type Range = (typeof RANGES)[number]

function Spark({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data), min = Math.min(...data)
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 100},${28 - ((v - min) / (max - min || 1)) * 24 - 2}`).join(' ')
  return <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="h-7 w-full" aria-hidden><polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></svg>
}

interface Totals { miles: number; gallons: number; fuelCost: number; idleHours: number; trips: number; alerts: number; onTime: number; mpg: number }
interface Day { date: string; miles: number; gallons: number; fuelCost: number; idleHours: number; onTime: number; trips: number; alerts: number; prevMiles: number | null }
interface OverviewData {
  range: number
  updatedAt: string
  vehicleCount: number
  depotCount: number
  totals: { current: Totals; previous: Totals }
  deltaPct: { miles: number; gallons: number; fuelCost: number; idleHours: number; mpg: number; onTimePts: number }
  days: Day[]
  depots: { depot: string; cost: number; units: number; perUnit: number }[]
  status: { status: Status; count: number }[]
  watchlist: { id: string; year: number; make: string; model: string; driver: string | null; depot: string; type: string; mpg: number; target: number; gap: number }[]
}
interface AlertsData { items: FleetAlert[]; open: number; total: number }

export default function Overview() {
  useTitle('Overview')
  const { settings, toast, refreshSummary } = useApp()
  const c = useChartColors()
  const u = settings.units
  const [range, setRange] = useState<Range>(30)
  const loc = useLocation()
  const ov = useApi<OverviewData>(`/overview?range=${range}`)
  const al = useApi<AlertsData>('/alerts?limit=9')
  useEffect(() => {
    if (loc.hash === '#alerts' && al.data) setTimeout(() => document.getElementById('alerts')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }, [loc.hash, al.data])

  if (!ov.data) return ov.error ? <ErrorPanel className="mx-auto max-w-[1400px]" error={ov.error} onRetry={ov.reload} /> : <LoadingPanel className="mx-auto max-w-[1400px]" label="Loading fleet overview…" />
  const o = ov.data
  const cur = o.days
  const T = o.totals.current, D = o.deltaPct
  const kpis = [
    { label: 'Distance', value: compact(dist(T.miles, u)), unit: distUnit(u), delta: D.miles, good: 'up', spark: cur.map((x) => x.miles) },
    { label: 'Fuel used', value: compact(vol(T.gallons, u)), unit: volUnit(u), delta: D.gallons, good: 'neutral', spark: cur.map((x) => x.gallons) },
    { label: 'Fuel spend', value: usd(T.fuelCost), unit: '', delta: D.fuelCost, good: 'down', spark: cur.map((x) => x.fuelCost) },
    { label: 'Fleet efficiency', value: num(eff(T.mpg, u), 2), unit: effUnit(u), delta: D.mpg * (u === 'metric' ? -1 : 1), good: u === 'metric' ? 'down' : 'up', spark: cur.map((x) => x.miles / x.gallons) },
    { label: 'On-time stops', value: T.onTime.toFixed(1), unit: '%', delta: D.onTimePts, good: 'up', pts: true, spark: cur.map((x) => x.onTime) },
    { label: 'Engine idle', value: num(T.idleHours), unit: 'h', delta: D.idleHours, good: 'down', spark: cur.map((x) => x.idleHours) },
  ]

  // dates come as YYYY-MM-DD (fleet-local); pin to noon so every browser time zone shows the same day
  const series = cur.map((d) => ({ date: `${d.date}T12:00:00`, miles: Math.round(dist(d.miles, u)), prev: d.prevMiles != null ? Math.round(dist(d.prevMiles, u)) : null }))
  const depotData = o.depots
  const statusData = o.status.map((x) => ({ s: x.status, name: STATUS_LABEL[x.status], value: x.count }))
  const total = Math.max(1, o.vehicleCount)
  const statusColor: Record<Status, string> = { moving: c.ok, idle: c.signal, parked: c.ink3, maintenance: c.warn, offline: c.crit }
  const watch = o.watchlist.map((v) => ({ v, gap: v.gap }))
  const alerts = al.data?.items ?? []
  const openCount = al.data?.open ?? 0
  const recent = alerts
  const onRoad = statusData[0].value + statusData[1].value

  const ackAlert = async (id: string) => {
    try {
      const updated = await api<FleetAlert>(`/alerts/${id}/ack`, { method: 'POST' })
      al.setData((d) => d && { ...d, open: Math.max(0, d.open - 1), items: d.items.map((a) => (a.id === id ? updated : a)) })
      refreshSummary()
      toast(`${id} acknowledged`)
    } catch (e) { toast((e as Error).message) }
  }
  const exportReport = async () => {
    try {
      const n = await download(`/reports/daily.csv${qs({ range, units: u })}`, `axlework-daily-${range}d.csv`)
      toast(`Exported ${n} days as CSV`)
    } catch (e) { toast((e as Error).message) }
  }
  const tickDate = (v: string) => day(v)

  return (
    <div className="mx-auto max-w-[1400px]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-[28px] leading-tight sm:text-[32px]">Operations overview</h1>
          <p className="mt-1 text-[13px] text-ink-2">
            {o.vehicleCount} units across {o.depotCount} depots · <span className="num">{onRoad}</span> on the road right now · updated {new Date(o.updatedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {ov.loading && <Spinner />}
          <div className="seg" role="group" aria-label="Date range">
            {RANGES.map((r) => <button key={r} aria-pressed={range === r} onClick={() => setRange(r)}>{r === 7 ? '7 days' : r === 30 ? '30 days' : '90 days'}</button>)}
          </div>
          <button className="btn-ghost h-8 px-3 text-xs" onClick={exportReport}><IDownload size={15} /> <span className="hidden sm:inline">Report</span></button>
        </div>
      </div>

      {/* KPI band */}
      <section className="panel mt-5 grid grid-cols-2 gap-px overflow-hidden bg-line md:grid-cols-3 xl:grid-cols-6" aria-label="Key metrics">
        {kpis.map((k, i) => {
          const up = k.delta >= 0
          const good = k.good === 'neutral' ? null : (k.good === 'up') === up
          return (
            <div key={k.label} className="bg-surface px-4 pt-3.5 pb-2">
              <div className="label">{k.label}</div>
              <div className="mt-1.5 flex items-baseline gap-1">
                <span className="num text-[24px] font-semibold leading-none tracking-tight">{k.value}</span>
                {k.unit && <span className="text-[12px] text-ink-3">{k.unit}</span>}
              </div>
              <div className={`mt-1.5 inline-flex items-center gap-0.5 text-[11.5px] font-semibold num ${good == null ? 'text-ink-2' : good ? 'text-ok' : 'text-crit'}`}>
                {up ? <IUp size={13} /> : <IDown size={13} />}{Math.abs(k.delta).toFixed(1)}{k.pts ? ' pts' : '%'}
                <span className="ml-1 font-normal text-ink-3 font-sans">vs prev.</span>
              </div>
              <Spark data={k.spark} color={i === 0 ? c.ink : c.ink3} />
            </div>
          )
        })}
      </section>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-12">
        <section className="panel xl:col-span-8">
          <div className="panel-head">
            <div className="panel-title">Distance driven per day</div>
            <div className="flex items-center gap-4 text-[11.5px] text-ink-2">
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-ink" />This period</span>
              <span className="flex items-center gap-1.5"><span className="w-4 border-t border-dashed border-ink-3" />Previous</span>
            </div>
          </div>
          <div className="h-[290px] px-2 pt-4 pb-1">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ left: 0, right: 12, top: 4, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={c.grid} />
                <XAxis dataKey="date" tickFormatter={tickDate} tick={{ fill: c.ink3 }} axisLine={{ stroke: c.grid }} tickLine={false} minTickGap={28} />
                <YAxis tickFormatter={(v) => compact(v)} tick={{ fill: c.ink3 }} axisLine={false} tickLine={false} width={44} />
                <Tooltip cursor={{ stroke: c.ink3, strokeDasharray: '3 3' }} content={<ChartTip labelFmt={(l) => new Date(l).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} valueFmt={(v) => `${num(v)} ${distUnit(u)}`} />} />
                <Area dataKey="prev" name="Previous" stroke={c.ink3} strokeDasharray="4 4" fill="none" strokeWidth={1.25} isAnimationActive={false} />
                <Area dataKey="miles" name="This period" stroke={c.ink} strokeWidth={2} fill={c.signal} fillOpacity={c.dark ? 0.1 : 0.22} isAnimationActive={false} activeDot={{ r: 4, fill: c.ink, stroke: c.surface, strokeWidth: 2 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="panel xl:col-span-4">
          <div className="panel-head"><div className="panel-title">Fleet status</div><Link to="/vehicles" className="text-[12px] font-semibold text-ink-2 hover:text-ink">All vehicles →</Link></div>
          <div className="flex flex-col items-center gap-2 p-4 sm:flex-row xl:flex-col 2xl:flex-row">
            <div className="relative h-[190px] w-[190px] shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={62} outerRadius={88} paddingAngle={1.5} stroke={c.surface} strokeWidth={2} startAngle={90} endAngle={-270} isAnimationActive={false}>
                    {statusData.map((d) => <Cell key={d.s} fill={statusColor[d.s]} />)}
                  </Pie>
                  <Tooltip content={<ChartTip valueFmt={(v) => `${v} units`} />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
                <div className="num text-[30px] font-semibold leading-none">{Math.round((onRoad / total) * 100)}%</div>
                <div className="mt-1 text-[11px] text-ink-3">utilisation</div>
              </div>
            </div>
            <ul className="w-full divide-y divide-line text-[13px]">
              {statusData.map((d) => (
                <li key={d.s}>
                  <Link to={`/vehicles?status=${d.s}`} className="flex items-center gap-2.5 py-2 hover:text-ink">
                    <span className={`h-2.5 w-2.5 rounded-[2px] ${STATUS_DOT[d.s]}`} />
                    <span className="text-ink-2">{d.name}</span>
                    <span className="num ml-auto font-semibold">{d.value}</span>
                    <span className="num w-10 text-right text-[11.5px] text-ink-3">{Math.round((d.value / total) * 100)}%</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="alerts" className="panel scroll-mt-20 xl:col-span-7">
          <div className="panel-head">
            <div className="flex items-center gap-2 panel-title">Alerts <span className="num rounded-[3px] bg-crit px-1.5 text-[11px] font-bold text-white">{openCount} open</span></div>
            <span className="text-[11.5px] text-ink-3">GPS + fuel sensor rules · last 6 days</span>
          </div>
          <ul className="divide-y divide-line">
            {al.error && <li className="px-4 py-6 text-center text-[12.5px] text-crit">{al.error.message} <button className="font-semibold underline" onClick={al.reload}>Retry</button></li>}
            {!al.data && !al.error && <li className="px-4 py-6 text-center text-[12.5px] text-ink-3">Loading alerts…</li>}
            {recent.map((a) => (
              <li key={a.id} className={`grid grid-cols-[auto_1fr_auto] items-start gap-x-3 px-4 py-2.5 ${a.acknowledged ? 'opacity-55' : ''}`}>
                <div className="pt-0.5"><Severity s={a.severity} /></div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                    <span className="font-semibold">{ALERT_LABEL[a.kind]}</span>
                    <Link to={`/vehicles/${a.vehicleId}`} className="num text-[12px] text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-ink">{a.vehicleId}</Link>
                  </div>
                  <div className="truncate text-[12.5px] text-ink-2">{a.text}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="num whitespace-nowrap text-[11.5px] text-ink-3">{ago(a.at)}</span>
                  {a.acknowledged ? (
                    <span className="grid h-7 w-7 place-items-center text-ok" title="Acknowledged"><ICheck size={15} /></span>
                  ) : (
                    <button className="btn-ghost btn-sm" onClick={() => ackAlert(a.id)}>Ack</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel xl:col-span-5">
          <div className="panel-head"><div className="panel-title">Fuel spend by depot</div><span className="text-[11.5px] text-ink-3">last {range} days</span></div>
          <div className="h-[230px] px-2 pt-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={depotData} layout="vertical" margin={{ left: 4, right: 64, top: 0, bottom: 0 }} barCategoryGap={9}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="depot" tick={{ fill: c.ink2, fontSize: 12 }} axisLine={false} tickLine={false} width={70} />
                <Tooltip cursor={{ fill: c.grid, opacity: 0.5 }} content={<ChartTip valueFmt={(v) => usd(v)} />} />
                <Bar dataKey="cost" name="Fuel spend" fill={c.signal} radius={[0, 2, 2, 0]} isAnimationActive={false}>
                  <LabelList dataKey="cost" position="right" formatter={(v: number) => usd(v)} style={{ fill: c.ink, fontSize: 11.5, fontFamily: 'JetBrains Mono Variable, monospace', fontWeight: 600 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="border-t border-line">
            <div className="label px-4 pt-2.5">Spend per unit</div>
            <div className="grid grid-cols-5 text-center">
              {depotData.map((d) => (
                <div key={d.depot} className="border-l border-line px-1 pb-2.5 pt-1 first:border-l-0">
                  <div className="num text-[12px] font-semibold">{usd(d.perUnit)}</div>
                  <div className="text-[10.5px] text-ink-3">{d.depot}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="panel xl:col-span-12">
          <div className="panel-head">
            <div className="panel-title">Efficiency watchlist <span className="ml-2 hidden font-normal text-ink-3 sm:inline">furthest below model target</span></div>
            <Link to="/vehicles?sort=mpg" className="text-[12px] font-semibold text-ink-2 hover:text-ink">Open in table →</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] whitespace-nowrap text-[13px]">
              <thead>
                <tr className="text-left">
                  {['Unit', 'Vehicle', 'Driver', 'Depot', `30-day ${effUnit(u)}`, 'Target', 'Gap'].map((h, i) => (
                    <th key={h} className={`label border-b border-line px-4 py-2 font-semibold ${i >= 4 ? 'text-right' : ''}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {watch.map(({ v, gap }) => (
                  <tr key={v.id} className="border-b border-line last:border-0 hover:bg-sunk/60">
                    <td className="px-4 py-2"><Link to={`/vehicles/${v.id}`} className="num font-semibold hover:underline">{v.id}</Link></td>
                    <td className="px-4 py-2 text-ink-2">{v.year} {v.make} {v.model}</td>
                    <td className="px-4 py-2">{v.driver ?? <span className="text-ink-3">Unassigned</span>}</td>
                    <td className="px-4 py-2 text-ink-2">{v.depot}</td>
                    <td className="num px-4 py-2 text-right font-semibold">{eff(v.mpg, u).toFixed(1)}</td>
                    <td className="num px-4 py-2 text-right text-ink-3">{eff(v.target, u).toFixed(1)}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-2">
                        <span className="relative h-1.5 w-24 overflow-hidden rounded-full bg-sunk"><span className="absolute inset-y-0 right-0 bg-crit" style={{ width: `${Math.min(100, Math.abs(gap) * 400)}%` }} /></span>
                        <span className="num w-12 text-right font-semibold text-crit">{(gap * 100).toFixed(1)}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
