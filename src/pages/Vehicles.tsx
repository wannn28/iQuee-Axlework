import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useApp } from '../store/app'
import { DEPOTS, STATUSES, STATUS_LABEL, TYPES, type Status, type Vehicle } from '../data/fleet'
import { StatusBadge, FuelBar, STATUS_DOT } from '../components/Status'
import { ago, dist, eff, effUnit, num } from '../lib/format'
import { api, download, qs, useApi } from '../lib/api'
import { Spinner } from '../components/States'
import { useTitle } from '../lib/useTitle'
import { ISearch, IDownload, IPlus, IUp, IDown, ISort, IChevron, IChevronLeft, ITrash, IX } from '../components/Icons'

type SortKey = 'id' | 'vehicle' | 'status' | 'driver' | 'depot' | 'fuelLevel' | 'odometer' | 'mpg' | 'lastSeen' | 'alerts'
interface ListResponse { items: Vehicle[]; total: number; page: number; size: number; pages: number; counts: Record<Status, number>; fleetTotal: number }

function IndeterminateCheck({ checked, indeterminate, onChange, label }: { checked: boolean; indeterminate: boolean; onChange: () => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate }, [indeterminate])
  return <input ref={ref} type="checkbox" className="check" checked={checked} onChange={onChange} aria-label={label} />
}

export default function Vehicles() {
  useTitle('Vehicles')
  const { settings, toast, refreshSummary } = useApp()
  const u = settings.units
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const q = sp.get('q') ?? ''
  const status = sp.get('status') ?? ''
  const depot = sp.get('depot') ?? ''
  const type = sp.get('type') ?? ''
  const sort = (sp.get('sort') as SortKey) || 'id'
  const dir = sp.get('dir') === 'desc' ? 'desc' : sp.get('dir') === 'asc' ? 'asc' : sort === 'alerts' ? 'desc' : 'asc'
  const page = Math.max(1, Number(sp.get('page') ?? 1))
  const size = [10, 25, 50].includes(Number(sp.get('size'))) ? Number(sp.get('size')) : 25
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmDel, setConfirmDel] = useState(false)

  const set = (patch: Record<string, string | number | null>, resetPage = true) => {
    const n = new URLSearchParams(sp)
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === '') n.delete(k); else n.set(k, String(v)) }
    if (resetPage && !('page' in patch)) n.delete('page')
    setSp(n, { replace: true })
  }

  // filtering, sorting and pagination happen in PostgreSQL; the URL stays the single source of truth
  const filterQs = { q: q.trim(), status, depot, type, sort, dir }
  const list = useApi<ListResponse>(`/vehicles${qs({ ...filterQs, page, size })}`, 250)
  const data = list.data
  const rows = data?.items ?? []
  const total = data?.total ?? 0
  const fleetTotal = data?.fleetTotal ?? 0
  const pages = data?.pages ?? 1
  const pg = data?.page ?? 1
  const pageIds = rows.map((r) => r.id)
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id))
  const someOnPage = pageIds.some((id) => selected.has(id))
  const counts = data?.counts ?? ({} as Record<Status, number>)
  const [busy, setBusy] = useState(false)

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const togglePage = () => setSelected((s) => { const n = new Set(s); pageIds.forEach((id) => (allOnPage ? n.delete(id) : n.add(id))); return n })

  const exportRows = async (label: 'filtered' | 'selected') => {
    try {
      const params = label === 'selected' ? { ids: [...selected].join(','), sort, dir } : filterQs
      const n = await download(`/vehicles/export.csv${qs({ ...params, units: u, label })}`, `axlework-vehicles-${label}.csv`)
      toast(`Exported ${n} vehicle${n === 1 ? '' : 's'} as CSV`)
    } catch (e) { toast((e as Error).message) }
  }
  const removeSelected = async () => {
    setBusy(true)
    try {
      const res = await api<{ deleted: number }>('/vehicles/bulk-delete', { method: 'POST', body: { ids: [...selected] } })
      toast(`Removed ${res.deleted} vehicles`)
      setSelected(new Set()); setConfirmDel(false)
      list.reload(); refreshSummary()
    } catch (e) { toast((e as Error).message) } finally { setBusy(false) }
  }

  const Th = ({ k, children, right = false, className = '' }: { k: SortKey; children: ReactNode; right?: boolean; className?: string }) => {
    const active = sort === k
    return (
      <th className={`border-b border-line-strong px-3 py-0 font-semibold ${right ? 'text-right' : 'text-left'} ${className}`} aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button onClick={() => set({ sort: k, dir: active ? (dir === 'asc' ? 'desc' : 'asc') : 'asc' }, false)} className={`group inline-flex h-9 items-center gap-1 label ${active ? '!text-ink' : 'hover:text-ink'} ${right ? 'flex-row-reverse' : ''}`}>
          {children}
          {active ? (dir === 'asc' ? <IUp size={13} /> : <IDown size={13} />) : <ISort size={12} className="opacity-0 group-hover:opacity-60" />}
        </button>
      </th>
    )
  }
  const filtersOn = q || status || depot || type

  return (
    <div className="mx-auto max-w-[1400px]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-[28px] leading-tight sm:text-[32px]">Vehicles</h1>
          <p className="mt-1 flex items-center gap-2 text-[13px] text-ink-2"><span><span className="num">{total}</span> of <span className="num">{fleetTotal}</span> units · click a row for trip, fuel and service history</span>{list.loading && data && <Spinner className="h-3 w-3" />}</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => exportRows('filtered')} disabled={!total}><IDownload size={16} /> Export CSV</button>
          <Link to="/vehicles/new" className="btn-primary"><IPlus size={16} /> Add vehicle</Link>
        </div>
      </div>

      {/* status tabs */}
      <div className="mt-5 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
        {[['', 'All', fleetTotal] as const, ...STATUSES.map((s) => [s, STATUS_LABEL[s], counts[s]] as const)].map(([s, label, n]) => (
          <button key={s || 'all'} role="tab" aria-selected={status === s} onClick={() => set({ status: s })}
            className={`-mb-px flex h-10 shrink-0 items-center gap-2 border-b-2 px-3 text-[13px] ${status === s ? 'border-ink font-semibold text-ink' : 'border-transparent text-ink-2 hover:text-ink'}`}>
            {s && <span className={`h-2 w-2 rounded-full ${STATUS_DOT[s]}`} />}{label}<span className="num text-[11px] text-ink-3">{data ? n ?? 0 : '·'}</span>
          </button>
        ))}
      </div>

      <div className="panel mt-4 overflow-hidden">
        {/* toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="relative w-full sm:w-72">
            <ISearch size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
            <input className="input pl-8" placeholder="Search unit, plate, driver, VIN…" value={q} onChange={(e) => set({ q: e.target.value })} aria-label="Search" />
          </div>
          <select className="input w-auto" value={depot} onChange={(e) => set({ depot: e.target.value })} aria-label="Depot">
            <option value="">All depots</option>
            {DEPOTS.map((d) => <option key={d}>{d}</option>)}
          </select>
          <select className="input w-auto" value={type} onChange={(e) => set({ type: e.target.value })} aria-label="Vehicle type">
            <option value="">All types</option>
            {TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
          {filtersOn && <button className="btn-quiet h-9 text-xs" onClick={() => setSp(new URLSearchParams(), { replace: true })}><IX size={14} /> Clear filters</button>}
          {selected.size > 0 && (
            <div className="flex w-full items-center gap-2 rounded-[5px] bg-ink py-1 pl-3 pr-1 text-bg sm:ml-auto sm:w-auto">
              <span className="text-[12.5px] font-semibold"><span className="num">{selected.size}</span> selected</span>
              <button className="btn btn-sm text-bg hover:bg-bg/10" onClick={() => exportRows('selected')}><IDownload size={14} /> Export</button>
              {confirmDel ? (
                <button className="btn btn-sm bg-crit text-white" disabled={busy} onClick={removeSelected}>{busy ? 'Removing…' : 'Confirm remove'}</button>
              ) : (
                <button className="btn btn-sm text-bg hover:bg-bg/10" onClick={() => setConfirmDel(true)}><ITrash size={14} /> Remove</button>
              )}
              <button className="btn btn-sm px-1.5 text-bg/70 hover:bg-bg/10" onClick={() => { setSelected(new Set()); setConfirmDel(false) }} aria-label="Clear selection"><IX size={14} /></button>
            </div>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] text-[13px]">
            <thead className="bg-sunk/50">
              <tr>
                <th className="w-10 border-b border-line-strong pl-4 pr-1"><IndeterminateCheck checked={allOnPage} indeterminate={!allOnPage && someOnPage} onChange={togglePage} label="Select page" /></th>
                <Th k="id">Unit</Th>
                <Th k="vehicle">Vehicle</Th>
                <Th k="status">Status</Th>
                <Th k="driver">Driver</Th>
                <Th k="depot">Depot</Th>
                <Th k="fuelLevel">Fuel</Th>
                <Th k="odometer" right>Odometer</Th>
                <Th k="mpg" right>{effUnit(u)}</Th>
                <Th k="lastSeen">Last seen</Th>
                <Th k="alerts" right className="pr-4">Alerts</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => {
                const sel = selected.has(v.id)
                return (
                  <tr key={v.id} onClick={() => nav(`/vehicles/${v.id}`)} className={`cursor-pointer border-b border-line last:border-0 ${sel ? 'bg-signal-soft/70' : 'hover:bg-sunk/60'}`}>
                    <td className="pl-4 pr-1" onClick={(e) => e.stopPropagation()}><input type="checkbox" className="check" checked={sel} onChange={() => toggle(v.id)} aria-label={`Select ${v.id}`} /></td>
                    <td className="px-3 py-2"><Link to={`/vehicles/${v.id}`} onClick={(e) => e.stopPropagation()} className="num font-semibold hover:underline">{v.id}</Link></td>
                    <td className="px-3 py-2">
                      <div className="leading-tight">{v.make} {v.model}</div>
                      <div className="text-[11.5px] text-ink-3">{v.year} · {v.type} · <span className="num">{v.plate}</span></div>
                    </td>
                    <td className="px-3 py-2"><StatusBadge s={v.status} />{v.status === 'moving' && <div className="num text-[11px] text-ink-3 pl-3.5">{Math.round(v.speed * (u === 'metric' ? 1.609 : 1))} {u === 'metric' ? 'km/h' : 'mph'}</div>}</td>
                    <td className="px-3 py-2">{v.driver ?? <span className="text-ink-3">—</span>}</td>
                    <td className="px-3 py-2 text-ink-2">{v.depot}</td>
                    <td className="px-3 py-2"><FuelBar v={v.fuelLevel} sensor={v.fuelSensor} /></td>
                    <td className="num px-3 py-2 text-right">{num(dist(v.odometer, u))}</td>
                    <td className="num px-3 py-2 text-right">{eff(v.mpg, u).toFixed(1)}</td>
                    <td className="px-3 py-2">
                      <div className="num text-[12px]">{ago(v.lastSeen)}</div>
                      <div className="max-w-[180px] truncate text-[11.5px] text-ink-3">{v.location}</div>
                    </td>
                    <td className="px-3 py-2 pr-4 text-right">
                      {v.alerts ? <span className="num inline-grid h-5 min-w-5 place-items-center rounded-[3px] bg-crit/10 px-1 text-[11.5px] font-bold text-crit">{v.alerts}</span> : <span className="text-ink-3">·</span>}
                    </td>
                  </tr>
                )
              })}
              {!data && list.loading && (
                <tr><td colSpan={11} className="px-4 py-16 text-center text-ink-2"><span className="inline-flex items-center gap-2"><Spinner />Loading vehicles…</span></td></tr>
              )}
              {list.error && (
                <tr><td colSpan={11} className="px-4 py-16 text-center text-crit" role="alert">{list.error.message} <button className="font-semibold underline" onClick={list.reload}>Retry</button></td></tr>
              )}
              {data && !list.error && !rows.length && (
                <tr><td colSpan={11} className="px-4 py-16 text-center text-ink-2">No vehicles match these filters. <button className="font-semibold underline" onClick={() => setSp(new URLSearchParams(), { replace: true })}>Clear filters</button></td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* pagination */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-[12.5px] text-ink-2">
          <div className="flex items-center gap-2">
            Rows
            <select className="input h-8 w-auto py-0 text-xs" value={size} onChange={(e) => set({ size: e.target.value })} aria-label="Rows per page">
              {[10, 25, 50].map((n) => <option key={n}>{n}</option>)}
            </select>
            <span className="num">{total ? (pg - 1) * size + 1 : 0}–{Math.min(pg * size, total)} of {total}</span>
          </div>
          <div className="flex items-center gap-1">
            <button className="btn-ghost btn-sm px-1.5" disabled={pg <= 1} onClick={() => set({ page: pg - 1 }, false)} aria-label="Previous page"><IChevronLeft size={15} /></button>
            {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
              <button key={n} onClick={() => set({ page: n }, false)} className={`num h-7 min-w-7 rounded-[4px] px-1.5 text-xs font-semibold ${n === pg ? 'bg-ink text-bg' : 'hover:bg-sunk'}`} aria-current={n === pg ? 'page' : undefined}>{n}</button>
            ))}
            <button className="btn-ghost btn-sm px-1.5" disabled={pg >= pages} onClick={() => set({ page: pg + 1 }, false)} aria-label="Next page"><IChevron size={15} /></button>
          </div>
        </div>
      </div>
    </div>
  )
}
