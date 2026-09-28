import { mulberry32, hashStr, int, between, pick } from '../lib/rand'
import { NOW, type Vehicle } from './fleet'

/* Schematic map geometry, shared by all vehicles (800 x 460 viewBox). */
export const MAP_W = 800
export const MAP_H = 460
export const COLS = [180, 250, 330, 400, 470, 550, 620, 700, 760]
export const ROWS = [50, 115, 180, 250, 320, 390, 430]
export const COAST = 'M0 0 H150 C132 60 170 92 142 150 C118 200 150 250 128 300 C110 352 150 396 118 460 H0 Z'
export const LAKE = 'M585 205 c28 -18 70 -10 78 14 c8 26 -26 42 -56 38 c-30 -4 -44 -36 -22 -52 Z'
export const PARKS = ['M262 330 h60 v52 h-60 Z', 'M480 60 h58 v46 h-58 Z', 'M640 330 h52 v48 h-52 Z']
export const HIGHWAY = 'M170 460 C230 380 300 330 360 290 S520 190 600 140 S740 60 800 30'

export type Pt = [number, number]
export interface Stop { pt: Pt; label: string; arrive: string; depart: string | null; kind: 'depot' | 'delivery' | 'fuel' }
export interface Route { path: Pt[]; stops: Stop[]; current: Pt | null; driven: Pt[]; miles: number }
export interface FuelPoint { t: string; level: number }
export type TLKind = 'ignition' | 'geofence' | 'arrive' | 'depart' | 'fuel' | 'overspeed' | 'idle' | 'drop' | 'brake' | 'off'
export interface TLItem { at: string; kind: TLKind; title: string; detail: string }
export interface Service { date: string; odometer: number; work: string; shop: string; cost: number }

const CUSTOMERS = ['Cascade Grocers DC', 'Northwind Hardware', 'Olympic Paper Co.', 'Riverbend Farms', 'Summit Medical Supply',
  'Ridgeline Beverage', 'Pioneer Building Supply', 'Evergreen Pet Foods', 'Harborview Hospital', 'Blue Mesa Outfitters']
const H = 3600_000

export function vehicleDetail(v: Vehicle) {
  const r = mulberry32(hashStr(v.id))
  
  // --- route along the street grid
  const node = (): Pt => [pick(r, COLS), pick(r, ROWS.slice(0, 6))]
  const depot: Pt = [COLS[int(r, 0, 2)], ROWS[int(r, 3, 5)]]
  const nStops = int(r, 3, 5)
  const stopsPts: Pt[] = [depot]
  while (stopsPts.length < nStops + 1) {
    const p = node()
    if (!stopsPts.some((q) => q[0] === p[0] && q[1] === p[1])) stopsPts.push(p)
  }
  const path: Pt[] = [depot]
  for (let i = 1; i < stopsPts.length; i++) {
    const [ax, ay] = path[path.length - 1]
    const [bx, by] = stopsPts[i]
    if (r() < 0.5) path.push([bx, ay]); else path.push([ax, by])
    path.push([bx, by])
  }
  const segLen = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])
  const total = path.slice(1).reduce((s, p, i) => s + segLen(path[i], p), 0)
  const miles = +(total / 6.2).toFixed(1)

  // timings (relative first, then anchored so "now" sits at the right point of the shift)
  const active = v.status === 'moving' || v.status === 'idle'
  const progress = active ? between(r, 0.45, 0.85) : 1
  const fuelStopIdx = v.fuelLevel < 40 ? -1 : int(r, 1, nStops)
  const rel: { arrive: number; depart: number }[] = [{ arrive: 0, depart: 25 * 60_000 }]
  let clock = 25 * 60_000
  for (let i = 1; i < stopsPts.length; i++) {
    clock += int(r, 24, 70) * 60_000
    const dwell = int(r, 12, 45) * 60_000
    rel.push({ arrive: clock, depart: clock + dwell })
    clock += dwell
  }
  const D = clock
  const t0 = active ? NOW - progress * D : new Date(v.lastSeen).getTime() - D
  const iso = (ms: number) => new Date(t0 + ms).toISOString()
  const stops: Stop[] = rel.map((x, i) => {
    const isFuel = i === fuelStopIdx
    return {
      pt: stopsPts[i],
      label: i === 0 ? `${v.depot} depot` : isFuel ? pick(r, ['Pilot Travel Center', "Love's Travel Stop", 'Chevron Commercial']) : pick(r, CUSTOMERS),
      arrive: iso(x.arrive),
      depart: i === rel.length - 1 && !active ? null : iso(x.depart),
      kind: i === 0 ? 'depot' : isFuel ? 'fuel' : 'delivery',
    }
  })
  const nowRel = progress * D
  const visibleStops = stops.filter((_, i) => rel[i].arrive <= nowRel + 1)

  const driven: Pt[] = [path[0]]
  let remain = total * progress
  let current: Pt | null = null
  for (let i = 1; i < path.length; i++) {
    const l = segLen(path[i - 1], path[i])
    if (remain >= l - 0.01) { driven.push(path[i]); remain -= l; continue }
    const f = remain / l
    current = [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * f, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * f]
    driven.push(current)
    break
  }
  if (!current) current = driven[driven.length - 1]
  const route: Route = { path, stops, current, driven, miles }

  // --- fuel level (%) over the last 24 h, 15-min samples
  const fuel: FuelPoint[] = []
  const start = NOW - 24 * H
  const SLOT = 15 * 60_000
  const slotOf = (ms: number) => Math.round((ms - start) / SLOT)
  const shiftA = slotOf(t0), shiftB = slotOf(t0 + Math.min(D, nowRel))
  const refuelAt = fuelStopIdx > 0 && rel[fuelStopIdx].arrive <= nowRel ? slotOf(t0 + rel[fuelStopIdx].arrive) : -1
  // a previous shift ~24 h earlier also burned fuel
  const prevA = shiftA - 96, prevB = slotOf(t0 + D) - 96
  const offShift: number[] = []
  for (let i = 1; i < 95; i++) if ((i < shiftA - 2 || i > shiftB + 2) && (i < prevA - 2 || i > prevB + 2)) offShift.push(i)
  const hasDrop = v.fuelSensor && offShift.length > 8 && r() < 0.4
  const dropAt = hasDrop ? offShift[int(r, 2, offShift.length - 3)] : -1
  const dropSize = between(r, 9, 22)
  const burn = v.type === 'Tractor' ? 0.5 : 1
  const deltas: number[] = []
  for (let i = 0; i < 96; i++) {
    const on = (i >= shiftA && i < shiftB) || (i >= prevA && i < prevB)
    let d = on ? -between(r, 0.5, 1.4) * burn : -between(r, 0, 0.04)
    if (i === refuelAt) d += 55
    if (i === dropAt) d -= dropSize
    deltas.push(d)
  }
  // walk backwards from the current level so the curve ends exactly at v.fuelLevel
  const levels: number[] = new Array(97)
  levels[96] = v.fuelLevel
  for (let i = 95; i >= 0; i--) levels[i] = Math.max(3, Math.min(98, levels[i + 1] - deltas[i]))
  for (let i = 0; i <= 96; i++) fuel.push({ t: new Date(start + i * SLOT).toISOString(), level: +levels[i].toFixed(1) })
  const drop = hasDrop ? { from: fuel[dropAt].t, to: fuel[dropAt + 1].t, gal: Math.round(((levels[dropAt] - levels[dropAt + 1]) / 100) * v.tankGal) } : null

  // --- timeline
  const tl: TLItem[] = []
  if (drop) tl.push({ at: drop.from, kind: 'drop', title: `Fuel drop · −${drop.gal} gal`, detail: 'Ignition off, vehicle stationary. Flagged as possible siphoning.' })
  {
    tl.push({ at: stops[0].arrive, kind: 'ignition', title: 'Ignition on', detail: `Pre-trip inspection · ${v.driver ?? 'Unassigned'}` })
    tl.push({ at: stops[0].depart!, kind: 'geofence', title: `Left ${v.depot} depot`, detail: 'Geofence exit' })
    visibleStops.slice(1).forEach((s, i) => {
      if (i === 0 && r() < 0.6) {
        const lim = pick(r, [55, 60])
        tl.push({ at: new Date(new Date(s.arrive).getTime() - int(r, 8, 20) * 60_000).toISOString(), kind: 'overspeed', title: `Overspeed · ${lim + int(r, 6, 12)} mph`, detail: `${lim} mph zone, ${int(r, 30, 120)} s` })
      }
      tl.push({ at: s.arrive, kind: s.kind === 'fuel' ? 'fuel' : 'arrive', title: s.kind === 'fuel' ? `Refuelled at ${s.label}` : `Arrived · ${s.label}`, detail: s.kind === 'fuel' ? `+${Math.round(0.55 * v.tankGal)} gal · fuel card ••${int(r, 1000, 9999)}` : `Stop ${i + 1} · ${int(r, 4, 26)} pallets` })
      if (s.depart && (i < visibleStops.length - 2 || !active) && new Date(s.depart).getTime() <= NOW) tl.push({ at: s.depart, kind: 'depart', title: 'Departed', detail: `Dwell ${Math.round((new Date(s.depart).getTime() - new Date(s.arrive).getTime()) / 60000)} min` })
      if (i === 1 && r() < 0.5) tl.push({ at: new Date(new Date(s.arrive).getTime() + 5 * 60_000).toISOString(), kind: 'idle', title: 'Excess idle', detail: `${int(r, 16, 34)} min with engine running` })
    })
    if (!active) tl.push({ at: v.lastSeen, kind: 'off', title: v.status === 'offline' ? 'Last GPS packet' : 'Ignition off', detail: v.location })
  }
  tl.sort((a, b) => b.at.localeCompare(a.at))

  // --- service history
  const shops = [`${v.depot} fleet shop`, 'TA Truck Service', 'Rush Truck Center', 'Pacific Diesel Works']
  const works = ['PM-A service · oil, filters, grease', 'Brake adjustment + pads (axle 2)', 'DOT annual inspection', 'Tire rotation · 2 steer replaced',
    'DPF cleaning', 'Coolant flush + hoses', 'Fuel sensor recalibration', 'Battery + alternator test', 'Clutch adjustment']
  const services: Service[] = []
  let odo = v.odometer
  let date = NOW - int(r, 4, 30) * 24 * H
  for (let i = 0; i < 6; i++) {
    odo -= int(r, 5000, 15000)
    date -= int(r, 25, 70) * 24 * H
    services.push({ date: new Date(date).toISOString(), odometer: Math.max(1000, odo), work: pick(r, works), shop: pick(r, shops), cost: int(r, 90, 1900) })
  }
  const today24 = { miles: +(miles * progress).toFixed(1), engineHours: +(between(r, 3, 9) * (progress || 0.1)).toFixed(1), idleMin: int(r, 8, 64), maxSpeed: int(r, 55, 71), score: int(r, 68, 98) }
  return { route, fuel, drop, timeline: tl, services, today: today24, progress, active }
}
