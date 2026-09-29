import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useApp } from '../store/app'
import { Logo } from './Logo'
import { STATUSES, STATUS_LABEL } from '../data/fleet'
import { STATUS_DOT } from './Status'
import { IOverview, ITruck, IPlus, ISettings, IBell, ISun, IMoon, IMenu, ICollapse, IExpand, ILogout, IX, ISearch } from './Icons'

const NAV = [
  { to: '/', label: 'Overview', icon: IOverview, end: true },
  { to: '/vehicles', label: 'Vehicles', icon: ITruck, end: false },
  { to: '/vehicles/new', label: 'Add vehicle', icon: IPlus, end: true },
  { to: '/settings', label: 'Settings', icon: ISettings, end: true },
]

function Sidebar({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { summary, logout, settings } = useApp()
  const counts = STATUSES.map((s) => ({ s, n: summary?.counts[s] ?? 0 }))
  const total = summary?.total ?? 0
  const onRoad = counts[0].n + counts[1].n
  const isNewPage = useLocation().pathname === '/vehicles/new'
  return (
    <div className="flex h-full flex-col">
      <div className={`flex h-14 items-center border-b border-line ${collapsed ? 'justify-center' : 'px-5'}`}>
        <Link to="/" onClick={onNavigate} aria-label="Axlework home"><Logo collapsed={collapsed} /></Link>
      </div>
      {!collapsed && (
        <div className="px-5 pt-5 pb-2">
          <div className="label">Workspace</div>
          <div className="mt-1 text-[13px] font-semibold leading-tight">{settings.company}</div>
        </div>
      )}
      <nav className={`flex flex-col gap-0.5 ${collapsed ? 'px-2 pt-4' : 'px-3 pt-2'}`}>
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            title={collapsed ? label : undefined}
            className={({ isActive: a }) => { const isActive = a && !(to === '/vehicles' && isNewPage); return (
              `group relative flex h-9 items-center gap-3 rounded-[5px] text-[13.5px] transition-colors ${collapsed ? 'justify-center' : 'px-2.5'} ${
                isActive ? 'bg-ink text-bg font-semibold' : 'text-ink-2 hover:bg-sunk hover:text-ink'
              }`) }
            }
          >
            {({ isActive: a }) => { const isActive = a && !(to === '/vehicles' && isNewPage); return (
              <>
                <Icon size={17} className={isActive ? 'text-signal' : ''} />
                {!collapsed && <span>{label}</span>}
                {!collapsed && to === '/vehicles' && <span className={`ml-auto num text-[11px] ${isActive ? 'text-bg/70' : 'text-ink-3'}`}>{summary ? total : '…'}</span>}
              </>
            ) }}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto">
        {!collapsed && (
          <div className="mx-5 mb-4 border-t border-line pt-4">
            <div className="flex items-baseline justify-between">
              <span className="label">On the road</span>
              <span className="num text-xs"><b className="text-ink">{onRoad}</b><span className="text-ink-3">/{total}</span></span>
            </div>
            <div className="mt-2 flex h-2 overflow-hidden rounded-[2px] gap-px">
              {counts.map(({ s, n }) => n > 0 && <span key={s} className={STATUS_DOT[s]} style={{ flex: n }} title={`${STATUS_LABEL[s]}: ${n}`} />)}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
              {counts.map(({ s, n }) => (
                <Link key={s} to={`/vehicles?status=${s}`} onClick={onNavigate} className="flex items-center gap-1.5 text-[11.5px] text-ink-2 hover:text-ink">
                  <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[s]}`} />{STATUS_LABEL[s]}<span className="num ml-auto text-ink-3">{n}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
        <div className={`border-t border-line ${collapsed ? 'p-2' : 'p-3'}`}>
          <button onClick={logout} title="Sign out" className={`btn-quiet w-full ${collapsed ? 'px-0' : 'justify-start'}`}>
            <ILogout size={16} />{!collapsed && 'Sign out'}
          </button>
        </div>
      </div>
    </div>
  )
}

const CRUMB: Record<string, string> = { '': 'Overview', vehicles: 'Vehicles', new: 'New', edit: 'Edit', settings: 'Settings' }

export function Layout() {
  const { theme, setTheme, summary, refreshSummary, settings, toasts } = useApp()
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('axw.collapsed') === '1')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [q, setQ] = useState('')
  const loc = useLocation()
  const nav = useNavigate()
  useEffect(() => { localStorage.setItem('axw.collapsed', collapsed ? '1' : '0') }, [collapsed])
  useEffect(() => { setMobileOpen(false); window.scrollTo(0, 0) }, [loc.pathname])
  // keep sidebar counts and the alert badge fresh while navigating
  useEffect(() => { refreshSummary() }, [loc.pathname, refreshSummary])
  const open = summary?.openAlerts ?? 0
  const parts = loc.pathname.split('/').filter(Boolean)
  const initials = settings.name.split(' ').map((w) => w[0]).slice(0, 2).join('')

  return (
    <div className="flex min-h-screen">
      {/* desktop sidebar */}
      <aside className={`relative z-30 hidden shrink-0 border-r border-line bg-bg transition-[width] duration-200 lg:block ${collapsed ? 'w-16' : 'w-60'}`}>
        <div className="sticky top-0 h-screen overflow-y-auto"><Sidebar collapsed={collapsed} /></div>
      </aside>
      {/* mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 border-r border-line bg-bg shadow-xl">
            <button onClick={() => setMobileOpen(false)} className="btn-quiet absolute right-2 top-2.5 px-2" aria-label="Close menu"><IX /></button>
            <Sidebar collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-bg/90 px-3 backdrop-blur sm:px-5">
          <button className="btn-quiet px-2 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu"><IMenu /></button>
          <button className="btn-quiet hidden px-2 lg:inline-flex" onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <IExpand size={17} /> : <ICollapse size={17} />}
          </button>
          <nav className="hidden items-center gap-1.5 text-[13px] sm:flex" aria-label="Breadcrumb">
            <span className="text-ink-3">Fleet</span>
            {(parts.length ? parts : ['']).map((p, i) => (
              <span key={i} className="flex items-center gap-1.5">
                <span className="text-line-strong">/</span>
                <span className={i === Math.max(parts.length - 1, 0) ? 'font-semibold' : 'text-ink-2'}>{CRUMB[p] ?? p}</span>
              </span>
            ))}
          </nav>
          <form
            className="relative ml-auto hidden w-full max-w-[16rem] sm:block"
            onSubmit={(e) => { e.preventDefault(); nav(`/vehicles?q=${encodeURIComponent(q)}`); setQ('') }}
          >
            <ISearch size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find unit, plate, driver…" className="input h-8 pl-8" aria-label="Search vehicles" />
          </form>
          <Link to="/vehicles" className="btn-quiet ml-auto px-2 sm:hidden" aria-label="Search vehicles"><ISearch size={17} /></Link>
          <span className="inline-flex h-6 items-center rounded-[3px] border border-dashed border-signal-text/60 bg-signal-soft px-2 text-[10.5px] font-bold uppercase tracking-label text-signal-text" title="Seeded demo dataset served from PostgreSQL by a Go API. Nothing here is real; it resets every 24 h.">
            Demo data
          </span>
          <button className="btn-quiet px-2" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle dark mode" title="Toggle theme">
            {theme === 'dark' ? <ISun size={17} /> : <IMoon size={17} />}
          </button>
          <Link to="/#alerts" className="btn-quiet relative px-2" aria-label={`${open} open alerts`}>
            <IBell size={17} />
            {open > 0 && <span className="absolute right-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-crit px-1 text-[9.5px] font-bold text-white num">{open}</span>}
          </Link>
          <Link to="/settings" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-signal text-[11px] font-bold text-[#181714]" title={settings.name}>{initials}</Link>
        </header>

        <main className="flex-1 px-3 pb-12 pt-5 sm:px-6 lg:px-8">
          <Outlet />
        </main>
        <footer className="border-t border-line px-3 py-4 text-[11.5px] text-ink-3 sm:px-6 lg:px-8 flex flex-wrap gap-x-4 gap-y-1">
          <span>Axlework is a portfolio demo by <a href="https://iquee.tech" className="underline decoration-line-strong underline-offset-2 hover:text-ink">iQuee</a>.</span>
          <span>All vehicles, people and numbers are seeded mock data, served live from a Go + PostgreSQL API.</span>
        </footer>
      </div>

      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col items-end gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto flex items-center gap-2 rounded-[5px] bg-ink px-3.5 py-2.5 text-[13px] text-bg shadow-lg">
            <span className="h-1.5 w-1.5 rounded-full bg-signal" />{t.text}
          </div>
        ))}
      </div>
    </div>
  )
}
