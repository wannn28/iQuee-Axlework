import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { SEED_FLEET, ALERTS, type Vehicle, type FleetAlert } from '../data/fleet'

export type Units = 'imperial' | 'metric'
export type Theme = 'light' | 'dark'
export interface Settings {
  name: string
  email: string
  company: string
  timezone: string
  units: Units
  fuelPrice: number
  idleLimit: number
  speedLimit: number
  fuelDropGal: number
  notifyEmail: boolean
  notifySms: boolean
  dailyDigest: boolean
}
export const DEFAULT_SETTINGS: Settings = {
  name: 'Alex Moreno',
  email: 'alex.moreno@harborpine.example',
  company: 'Harbor & Pine Freight Co.',
  timezone: 'America/Los_Angeles',
  units: 'imperial',
  fuelPrice: 4.12,
  idleLimit: 15,
  speedLimit: 65,
  fuelDropGal: 8,
  notifyEmail: true,
  notifySms: false,
  dailyDigest: true,
}
interface Toast { id: number; text: string }

interface Ctx {
  authed: boolean
  login: () => void
  logout: () => void
  theme: Theme
  setTheme: (t: Theme) => void
  vehicles: Vehicle[]
  saveVehicle: (v: Vehicle) => void
  deleteVehicles: (ids: string[]) => void
  alerts: FleetAlert[]
  ackAlert: (id: string) => void
  settings: Settings
  setSettings: (s: Settings) => void
  resetDemo: () => void
  toasts: Toast[]
  toast: (text: string) => void
}
const AppCtx = createContext<Ctx | null>(null)
const VERSION = 'v1'
function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`axw.${key}`)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
const save = (key: string, v: unknown) => {
  try { localStorage.setItem(`axw.${key}`, typeof v === 'string' ? v : JSON.stringify(v)) } catch { /* private mode */ }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState(() => load('authed', false))
  const [theme, setThemeState] = useState<Theme>(() => (localStorage.getItem('axw.theme') === 'dark' ? 'dark' : 'light'))
  const [vehicles, setVehicles] = useState<Vehicle[]>(() => (load<string>('version', '') === VERSION ? load('vehicles', SEED_FLEET) : SEED_FLEET))
  const [acked, setAcked] = useState<string[]>(() => load('acked', []))
  const [settings, setSettingsState] = useState<Settings>(() => ({ ...DEFAULT_SETTINGS, ...load('settings', {}) }))
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => { document.documentElement.classList.toggle('dark', theme === 'dark'); save('theme', theme) }, [theme])
  useEffect(() => { save('vehicles', vehicles); save('version', VERSION) }, [vehicles])

  const toast = useCallback((text: string) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200)
  }, [])

  const value = useMemo<Ctx>(() => ({
    authed,
    login: () => { setAuthed(true); save('authed', true) },
    logout: () => { setAuthed(false); save('authed', false) },
    theme,
    setTheme: setThemeState,
    vehicles,
    saveVehicle: (v) => setVehicles((all) => (all.some((x) => x.id === v.id) ? all.map((x) => (x.id === v.id ? v : x)) : [...all, v].sort((a, b) => a.id.localeCompare(b.id)))),
    deleteVehicles: (ids) => setVehicles((all) => all.filter((v) => !ids.includes(v.id))),
    alerts: ALERTS.map((a) => (acked.includes(a.id) ? { ...a, acknowledged: true } : a)),
    ackAlert: (id) => setAcked((a) => { const n = [...a, id]; save('acked', n); return n }),
    settings,
    setSettings: (s) => { setSettingsState(s); save('settings', s) },
    resetDemo: () => {
      setVehicles(SEED_FLEET); setAcked([]); save('acked', []); setSettingsState(DEFAULT_SETTINGS); save('settings', DEFAULT_SETTINGS)
    },
    toasts,
    toast,
  }), [authed, theme, vehicles, acked, settings, toasts, toast])

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useApp() {
  const c = useContext(AppCtx)
  if (!c) throw new Error('useApp outside provider')
  return c
}
