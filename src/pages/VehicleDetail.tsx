import { type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Area, AreaChart, CartesianGrid, ReferenceArea, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useApp } from '../store/app'
import type { TLKind, Route, FuelPoint, TLItem, Service } from '../data/detail'
import { STATUS_LABEL, type Vehicle } from '../data/fleet'
import { RouteMap } from '../components/RouteMap'
import { StatusBadge } from '../components/Status'
import { ChartTip, useChartColors } from '../components/chart'
import { usd, num, dist, distUnit, vol, volUnit, eff, effUnit, speed, speedUnit, ago, time, dayFull } from '../lib/format'
import { toCSV, downloadCSV } from '../lib/csv'
import { useApi } from '../lib/api'
import { ErrorPanel, LoadingPanel } from '../components/States'
import { useTitle } from '../lib/useTitle'
import { IArrowLeft, IEdit, IDownload, IFuel, IAlert } from '../components/Icons'
import NotFound from './NotFound'

const TL_STYLE: Record<TLKind, string> = {
  ignition: 'bg-ink', geofence: 'bg-ink-3', arrive: 'bg-ok', depart: 'bg-surface border-2 border-ink-3', fuel: 'bg-signal',
  overspeed: 'bg-warn', idle: 'bg-warn', drop: 'bg-crit', brake: 'bg-warn', off: 'bg-ink-3',
}

interface DetailResponse {
  vehicle: Vehicle
  trip: { route: Route; today: { miles: number; engineHours: number; idleMin: number; maxSpeed: number; score: number }; progress: number; active: boolean } | null
  fuel: { readings: FuelPoint[]; drop: { from: string; to: string; gal: number; pct: number } | null; thresholdGal: number }
  timeline: TLItem[]
  services: Service[]
}
const EMPTY_ROUTE: Route = { path: [], stops: [], current: null, driven: [], miles: 0 }

export default function VehicleDetail() {
  const { id } = useParams()
  const { settings, toast } = useApp()
  const c = useChartColors()
  const u = settings.units
  const res = useApi<DetailResponse>(`/vehicles/${encodeURIComponent(id ?? '')}/detail`)
  const v = res.data?.vehicle
  useTitle(v ? v.id : res.error?.status === 404 ? 'Not found' : 'Vehicle')
  if (res.error?.status === 404) return <NotFound />
  if (!res.data || !v) return res.error ? <ErrorPanel className="mx-auto max-w-[1400px]" error={res.error} onRetry={res.reload} /> : <LoadingPanel className="mx-auto max-w-[1400px]" label="Loading vehicle…" />
  const r = res.data
  const d = {
    route: r.trip?.route ?? EMPTY_ROUTE,
    today: r.trip?.today ?? { miles: 0, engineHours: 0, idleMin: 0, maxSpeed: 0, score: 100 },
    active: r.trip?.active ?? false,
    fuel: r.fuel.readings,
    drop: r.fuel.drop,
    timeline: r.timeline,
    services: r.services,
  }

  const fuelData = d.fuel.map((p) => ({ t: p.t, level: p.level }))
  const dropPoint = d.drop ? fuelData.find((p) => p.t === d.drop!.to) : null
  const exportLog = () => {
    downloadCSV(`${v.id}-timeline.csv`, toCSV([...d.timeline].reverse().map((t) => ({ time: t.at, event: t.title, detail: t.detail }))))
    toast(`Exported ${d.timeline.length} events`)
  }
  const stats = [
    { label: 'Speed', value: v.status === 'moving' ? Math.round(speed(v.speed, u)).toString() : '0', unit: speedUnit(u), sub: STATUS_LABEL[v.status] },
    { label: 'Fuel', value: v.fuelSensor ? `${v.fuelLevel}%` : '—', unit: '', sub: v.fuelSensor ? `${num(vol((v.fuelLevel / 100) * v.tankGal, u))} of ${num(vol(v.tankGal, u))} ${volUnit(u)}` : 'No tank sensor' },
    { label: 'Distance today', value: num(dist(d.today.miles, u), 1), unit: distUnit(u), sub: `${d.route.stops.length - 1} stops planned` },
    { label: 'Engine hours', value: d.today.engineHours.toFixed(1), unit: 'h', sub: `${d.today.idleMin} min idle` },
    { label: '30-day avg', value: eff(v.mpg, u).toFixed(1), unit: effUnit(u), sub: `${v.type} fleet` },
    { label: 'Driver score', value: String(d.today.score), unit: '/100', sub: v.driver ?? 'Unassigned' },
  ]
  const specs: [string, ReactNode][] = [
    ['Plate', <span className="num">{v.plate}</span>],
    ['VIN', <span className="num text-[12px]">{v.vin}</span>],
    ['Type', v.type],
    ['Depot', v.depot],
    ['Driver', v.driver ?? <span className="text-ink-3">Unassigned</span>],
    ['Odometer', <span className="num">{num(dist(v.odometer, u))} {distUnit(u)}</span>],
    ['Tank', <span className="num">{num(vol(v.tankGal, u))} {volUnit(u)}</span>],
    ['GPS tracker', <span className="num text-[12px]">IMEI {v.imei}</span>],
    ['Fuel sensor', v.fuelSensor ? 'Capacitive probe · calibrated' : <span className="text-ink-3">Not installed</span>],
    ['Next service', v.nextServiceMi < 0 ? <span className="font-semibold text-crit">Overdue by {num(dist(-v.nextServiceMi, u))} {distUnit(u)}</span> : <span className="num">in {num(dist(v.nextServiceMi, u))} {distUnit(u)}</span>],
    ['Health', <span className="flex items-center gap-2"><span className="relative h-1.5 w-20 overflow-hidden rounded-full bg-sunk"><span className={`absolute inset-y-0 left-0 ${v.health < 60 ? 'bg-crit' : v.health < 80 ? 'bg-warn' : 'bg-ok'}`} style={{ width: `${v.health}%` }} /></span><span className="num">{v.health}</span></span>],
  ]

  return (
    <div className="mx-auto max-w-[1400px]">
      <Link to="/vehicles" className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-2 hover:text-ink"><IArrowLeft size={15} /> Vehicles</Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <h1 className="display num text-[34px] leading-none">{v.id}</h1>
            <StatusBadge s={v.status} />
            {v.alerts > 0 && <span className="inline-flex items-center gap-1 rounded-[3px] bg-crit/10 px-1.5 py-0.5 text-[11.5px] font-bold text-crit"><IAlert size={13} />{v.alerts} open</span>}
          </div>
          <p className="mt-2 text-[14px] text-ink-2">{v.year} {v.make} {v.model} · {v.location} · <span className="num">seen {ago(v.lastSeen)}</span></p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={exportLog}><IDownload size={16} /> Trip log</button>
          <Link to={`/vehicles/${v.id}/edit`} className="btn-primary"><IEdit size={16} /> Edit</Link>
        </div>
      </div>

      <section className="panel mt-5 grid grid-cols-2 gap-px overflow-hidden bg-line md:grid-cols-3 xl:grid-cols-6">
        {stats.map((s) => (
          <div key={s.label} className="bg-surface px-4 py-3">
            <div className="label">{s.label}</div>
            <div className="mt-1 flex items-baseline gap-1"><span className="num text-[22px] font-semibold leading-none">{s.value}</span><span className="text-[12px] text-ink-3">{s.unit}</span></div>
            <div className="mt-1 truncate text-[11.5px] text-ink-3">{s.sub}</div>
          </div>
        ))}
      </section>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-12">
        <div className="space-y-5 xl:col-span-8">
          <section className="panel overflow-hidden">
            <div className="panel-head">
              <div className="panel-title">{d.active ? 'Today’s route' : 'Last trip'} <span className="ml-2 font-normal text-ink-3">{d.route.stops.length - 1} stops · {num(dist(d.route.miles, u), 1)} {distUnit(u)} planned</span></div>
              <div className="hidden items-center gap-4 text-[11.5px] text-ink-2 sm:flex">
                <span className="flex items-center gap-1.5"><span className="h-1 w-4 rounded bg-ink" />Driven</span>
                <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dotted border-ink-3" />Planned</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-2 border-ink bg-signal" />Now</span>
              </div>
            </div>
            <RouteMap route={d.route} />
            <div className="border-t border-line px-4 py-2 text-[11px] text-ink-3">Schematic map · route points and stops come from PostgreSQL (seeded GPS replay), no map provider used.</div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <div className="panel-title flex items-center gap-2"><IFuel size={16} /> Tank level · last 24 h</div>
              {d.drop ? (
                <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-crit"><span className="h-2 w-2 rounded-full bg-crit" />Drop of {num(vol(d.drop.gal, u))} {volUnit(u)} at {time(d.drop.from)}</span>
              ) : (
                <span className="text-[12px] text-ink-3">{v.fuelSensor ? `No drops ≥ ${num(vol(r.fuel.thresholdGal, u))} ${volUnit(u)}` : 'No sensor installed'}</span>
              )}
            </div>
            {v.fuelSensor ? (
              <div className="h-[220px] px-2 pt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={fuelData} margin={{ left: 0, right: 16, top: 6, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={c.grid} />
                    <XAxis dataKey="t" tickFormatter={(t) => time(t)} tick={{ fill: c.ink3 }} axisLine={{ stroke: c.grid }} tickLine={false} minTickGap={40} />
                    <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} tick={{ fill: c.ink3 }} axisLine={false} tickLine={false} width={42} />
                    <Tooltip content={<ChartTip labelFmt={(l) => time(l)} valueFmt={(val) => `${val}%`} />} />
                    {d.drop && <ReferenceArea x1={fuelData[Math.max(0, fuelData.findIndex((p) => p.t === d.drop!.from) - 1)].t} x2={fuelData[Math.min(fuelData.length - 1, fuelData.findIndex((p) => p.t === d.drop!.to) + 1)].t} fill={c.crit} fillOpacity={0.12} />}
                    <Area type="stepAfter" dataKey="level" name="Tank level" stroke={c.ink} strokeWidth={1.75} fill={c.ink} fillOpacity={0.06} isAnimationActive={false} />
                    {dropPoint && <ReferenceDot x={dropPoint.t} y={dropPoint.level} r={4} fill={c.crit} stroke={c.surface} strokeWidth={2} />}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="px-4 py-10 text-center text-[13px] text-ink-2">This unit has no tank-level probe. Fuel is estimated from fuel-card transactions only.</div>
            )}
          </section>
        </div>

        <div className="space-y-5 xl:col-span-4">
          <section className="panel">
            <div className="panel-head"><div className="panel-title">Timeline</div><span className="text-[11.5px] text-ink-3">{d.timeline.length} events</span></div>
            <ol className="relative px-4 py-3">
              {d.timeline.map((t, i) => (
                <li key={i} className="relative grid grid-cols-[44px_14px_1fr] gap-x-2 pb-3.5 last:pb-0">
                  <span className="num pt-px text-[11.5px] text-ink-3">{time(t.at)}</span>
                  <span className="relative flex justify-center">
                    <span className={`z-10 mt-1 h-2.5 w-2.5 rounded-full ${TL_STYLE[t.kind]}`} />
                    {i < d.timeline.length - 1 && <span className="absolute bottom-[-14px] top-3 w-px bg-line-strong" />}
                  </span>
                  <span className="min-w-0">
                    <span className={`block text-[13px] font-semibold leading-snug ${t.kind === 'drop' ? 'text-crit' : ''}`}>{t.title}</span>
                    <span className="block text-[12px] leading-snug text-ink-2">{t.detail}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <section className="panel">
            <div className="panel-head"><div className="panel-title">Unit details</div></div>
            <dl className="divide-y divide-line text-[13px]">
              {specs.map(([k, val]) => (
                <div key={k} className="grid grid-cols-[110px_1fr] gap-3 px-4 py-2">
                  <dt className="text-ink-3">{k}</dt><dd className="min-w-0 break-words">{val}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>

        <section className="panel xl:col-span-12">
          <div className="panel-head"><div className="panel-title">Service history</div><span className="num text-[12px] text-ink-2">{usd(d.services.reduce((s, x) => s + x.cost, 0))} last 6 visits</span></div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead><tr className="text-left">{['Date', 'Odometer', 'Work performed', 'Shop', 'Cost'].map((h, i) => <th key={h} className={`label border-b border-line px-4 py-2 ${i === 1 || i === 4 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
              <tbody>
                {d.services.map((s, i) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    <td className="num px-4 py-2">{dayFull(s.date)}</td>
                    <td className="num px-4 py-2 text-right text-ink-2">{num(dist(s.odometer, u))} {distUnit(u)}</td>
                    <td className="px-4 py-2">{s.work}</td>
                    <td className="px-4 py-2 text-ink-2">{s.shop}</td>
                    <td className="num px-4 py-2 text-right font-semibold">{usd(s.cost)}</td>
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
