import type { Units } from '../store/app'

export const usd = (n: number, digits = 0) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: digits, minimumFractionDigits: digits })
export const num = (n: number, digits = 0) => n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })
export const compact = (n: number) => n.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 })
export const pct = (n: number, digits = 1) => `${n.toFixed(digits)}%`

const MI_KM = 1.609344
const GAL_L = 3.785411784
export const dist = (mi: number, u: Units) => (u === 'metric' ? mi * MI_KM : mi)
export const distUnit = (u: Units) => (u === 'metric' ? 'km' : 'mi')
export const vol = (gal: number, u: Units) => (u === 'metric' ? gal * GAL_L : gal)
export const volUnit = (u: Units) => (u === 'metric' ? 'L' : 'gal')
/** mpg -> L/100km when metric */
export const eff = (mpg: number, u: Units) => (u === 'metric' ? 235.215 / mpg : mpg)
export const effUnit = (u: Units) => (u === 'metric' ? 'L/100km' : 'mpg')
export const speed = (mph: number, u: Units) => (u === 'metric' ? mph * MI_KM : mph)
export const speedUnit = (u: Units) => (u === 'metric' ? 'km/h' : 'mph')

export function ago(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.round(h / 24)} d ago`
}
export const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
export const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
export const dayFull = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
