import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Status } from '../data/fleet'
import { api, getToken, setToken, setUnauthorizedHandler } from '../lib/api'

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
export interface Summary { total: number; counts: Record<Status, number>; openAlerts: number }
interface Toast { id: number; text: string }
export type LoginInput = { demo: true } | { email: string; password: string }

interface Ctx {
  authed: boolean
  login: (input: LoginInput) => Promise<void>
  logout: () => void
  theme: Theme
  setTheme: (t: Theme) => void
  /** fleet-wide counts for the sidebar / header; refreshed after every mutation */
  summary: Summary | null
  refreshSummary: () => void
  settings: Settings
  saveSettings: (s: Settings) => Promise<void>
  resetDemo: () => Promise<void>
  toasts: Toast[]
  toast: (text: string) => void
}
const AppCtx = createContext<Ctx | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState(() => !!getToken())
  const [theme, setThemeState] = useState<Theme>(() => (localStorage.getItem('axw.theme') === 'dark' ? 'dark' : 'light'))
  const [summary, setSummary] = useState<Summary | null>(null)
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS)
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => { document.documentElement.classList.toggle('dark', theme === 'dark'); localStorage.setItem('axw.theme', theme) }, [theme])

  const logout = useCallback(() => { setToken(null); setAuthed(false); setSummary(null) }, [])
  useEffect(() => { setUnauthorizedHandler(logout); return () => setUnauthorizedHandler(null) }, [logout])

  const refreshSummary = useCallback(() => {
    api<Summary>('/fleet/summary').then(setSummary).catch(() => { /* sidebar keeps last value */ })
  }, [])
  useEffect(() => {
    if (!authed) return
    refreshSummary()
    api<Settings>('/settings').then(setSettingsState).catch(() => { /* defaults until reachable */ })
  }, [authed, refreshSummary])

  const toast = useCallback((text: string) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200)
  }, [])

  const value = useMemo<Ctx>(() => ({
    authed,
    login: async (input) => {
      const res = await api<{ token: string }>('/auth/login', { method: 'POST', body: input })
      setToken(res.token)
      setAuthed(true)
    },
    logout,
    theme,
    setTheme: setThemeState,
    summary,
    refreshSummary,
    settings,
    saveSettings: async (s) => { setSettingsState(await api<Settings>('/settings', { method: 'PUT', body: s })) },
    resetDemo: async () => {
      await api('/demo/reset', { method: 'POST' })
      setSettingsState(await api<Settings>('/settings'))
      refreshSummary()
    },
    toasts,
    toast,
  }), [authed, logout, theme, summary, refreshSummary, settings, toasts, toast])

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useApp() {
  const c = useContext(AppCtx)
  if (!c) throw new Error('useApp outside provider')
  return c
}
