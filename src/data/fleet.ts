import { mulberry32, pick, between, int } from '../lib/rand'

export type VehicleType = 'Tractor' | 'Box truck' | 'Reefer' | 'Cargo van' | 'Pickup'
export type Status = 'moving' | 'idle' | 'parked' | 'maintenance' | 'offline'

export interface Vehicle {
  id: string
  plate: string
  vin: string
  make: string
  model: string
  year: number
  type: VehicleType
  depot: string
  driver: string | null
  status: Status
  odometer: number // miles
  fuelLevel: number // %
  tankGal: number
  mpg: number // 30-day average
  speed: number // mph
  location: string
  lastSeen: string // ISO
  imei: string
  fuelSensor: boolean
  alerts: number
  health: number // 0-100
  nextServiceMi: number
  notes: string
  createdAt: string
}

export const DEPOTS = ['Tacoma', 'Portland', 'Spokane', 'Boise', 'Eugene'] as const
export const TYPES: VehicleType[] = ['Tractor', 'Box truck', 'Reefer', 'Cargo van', 'Pickup']
export const STATUSES: Status[] = ['moving', 'idle', 'parked', 'maintenance', 'offline']
export const STATUS_LABEL: Record<Status, string> = {
  moving: 'Moving', idle: 'Idling', parked: 'Parked', maintenance: 'In service', offline: 'No signal',
}
const STATE: Record<string, string> = { Tacoma: 'WA', Portland: 'OR', Spokane: 'WA', Boise: 'ID', Eugene: 'OR' }

export const DRIVERS = [
  'Marcus Hale', 'Dana Whitfield', 'Luis Ortega', 'Priya Raman', 'Tom Brennan', 'Keisha Moore', 'Andre Castillo',
  'Hannah Lindqvist', 'Ray Delgado', 'Samir Haddad', 'Janet Okafor', 'Cody Pruitt', 'Mei Tanaka', 'Victor Sousa',
  'Brianna Cole', 'Eli Rasmussen', 'Nadia Petrov', 'Grant McAllister', 'Rosa Jimenez', 'Owen Fitzgerald',
  'Tasha Greene', 'Kyle Bergstrom', 'Imani Brooks', 'Derek Yoon', 'Carla Mendes', 'Hector Ruiz', 'Leah Novak',
  'Jamal Rivers', 'Wes Harlan', 'Anika Shah', 'Paul Kowalski', 'Gloria Nguyen', 'Trent Albright', 'Sofia Marino',
  'Ben Achterberg', 'Lauren Pike', 'Mateo Vargas', 'Ruth Ellison', 'Isaac Farrow', 'Kendra Walsh',
  'Nora Castellanos', 'Jared Whitaker', 'Aisha Bello', 'Frank DeLuca', 'Yuki Mori', 'Scott Halvorsen', 'Tamara Reyes', 'Devin Clarke',
  'Olivia Grant', 'Manny Ochoa', 'Greta Lund', 'Chris Ambrose', 'Lena Haas', 'Rashad King', 'Molly Keane', 'Zach Turner',
  'Pilar Duarte', 'Emmett Shaw', 'Joy Adeyemi', 'Colin Byrne', 'Vanessa Liu', 'Arturo Fuentes',
]

const MODELS: Record<VehicleType, { make: string; model: string }[]> = {
  Tractor: [
    { make: 'Freightliner', model: 'Cascadia 126' }, { make: 'Kenworth', model: 'T680' },
    { make: 'Peterbilt', model: '579' }, { make: 'Volvo', model: 'VNL 760' },
  ],
  'Box truck': [{ make: 'Isuzu', model: 'NPR-HD' }, { make: 'Hino', model: 'L6' }, { make: 'Ford', model: 'F-750' }],
  Reefer: [{ make: 'Freightliner', model: 'M2 106 Reefer' }, { make: 'International', model: 'MV607 Reefer' }],
  'Cargo van': [{ make: 'Ford', model: 'Transit 250' }, { make: 'Mercedes-Benz', model: 'Sprinter 2500' }, { make: 'Ram', model: 'ProMaster 2500' }],
  Pickup: [{ make: 'Ford', model: 'F-150' }, { make: 'Chevrolet', model: 'Silverado 2500HD' }],
}
const SPEC: Record<VehicleType, { mpg: [number, number]; tank: [number, number]; prefix: string; odo: [number, number] }> = {
  Tractor: { mpg: [6.1, 7.9], tank: [200, 300], prefix: '1', odo: [90000, 610000] },
  'Box truck': { mpg: [8.8, 12.2], tank: [40, 66], prefix: '2', odo: [30000, 240000] },
  Reefer: { mpg: [7.6, 9.8], tank: [50, 70], prefix: '3', odo: [40000, 280000] },
  'Cargo van': { mpg: [14, 19.5], tank: [25, 25], prefix: '4', odo: [12000, 180000] },
  Pickup: { mpg: [14.5, 20.5], tank: [26, 36], prefix: '5', odo: [8000, 140000] },
}
const ROADS: Record<string, string[]> = {
  Tacoma: ['I-5 N · Fife, WA', 'SR-167 S · Kent, WA', 'I-705 · Tacoma, WA', 'SR-18 E · Auburn, WA', 'I-5 S · Lacey, WA'],
  Portland: ['I-84 E · Troutdale, OR', 'I-205 N · Clackamas, OR', 'US-26 W · Beaverton, OR', 'I-5 S · Wilsonville, OR'],
  Spokane: ['I-90 E · Spokane Valley, WA', 'US-395 N · Deer Park, WA', 'US-195 S · Spangle, WA'],
  Boise: ['I-84 W · Nampa, ID', 'I-184 · Boise, ID', 'US-20 · Eagle, ID'],
  Eugene: ['I-5 N · Springfield, OR', 'OR-126 W · Veneta, OR', 'OR-99 · Junction City, OR'],
}

export const NOW = Date.now()
const HOUR = 3600_000
const DAY = 24 * HOUR
const VIN_CHARS = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789'

function makeFleet(): Vehicle[] {
  const r = mulberry32(20260929)
  const typeWeights: VehicleType[] = ['Tractor', 'Tractor', 'Tractor', 'Box truck', 'Box truck', 'Reefer', 'Cargo van', 'Cargo van', 'Pickup']
  const depotWeights = ['Tacoma', 'Tacoma', 'Tacoma', 'Portland', 'Portland', 'Portland', 'Spokane', 'Boise', 'Eugene', 'Eugene']
  const drivers = [...DRIVERS]
  const out: Vehicle[] = []
  const counters: Record<string, number> = {}
  for (let i = 0; i < 68; i++) {
    const type = pick(r, typeWeights)
    const spec = SPEC[type]
    const m = pick(r, MODELS[type])
    const depot = pick(r, depotWeights)
    counters[spec.prefix] = (counters[spec.prefix] ?? 0) + 1
    const id = `HP-${spec.prefix}${String(counters[spec.prefix] * 7 + int(r, 0, 6)).padStart(3, '0')}`
    const s = r()
    const status: Status = s < 0.44 ? 'moving' : s < 0.58 ? 'idle' : s < 0.84 ? 'parked' : s < 0.93 ? 'maintenance' : 'offline'
    const year = int(r, 2016, 2025)
    const mpg = +between(r, spec.mpg[0], spec.mpg[1]).toFixed(1)
    const driver = status === 'maintenance' || drivers.length === 0 || r() < 0.08 ? null : drivers.splice(int(r, 0, drivers.length - 1), 1)[0]
    const lastSeen =
      status === 'moving' || status === 'idle' ? NOW - int(r, 4, 90) * 1000
        : status === 'parked' ? NOW - int(r, 20, 900) * 60_000
          : status === 'maintenance' ? NOW - int(r, 3, 60) * HOUR
            : NOW - int(r, 26, 140) * HOUR
    const alerts = status === 'offline' ? int(r, 1, 2) : r() < 0.3 ? int(r, 1, 4) : 0
    out.push({
      id,
      plate: `${STATE[depot]} ${pick(r, ['C', 'B', 'D', 'T', 'A'])}${int(r, 10000, 99999)}`,
      vin: Array.from({ length: 17 }, () => pick(r, VIN_CHARS.split(''))).join(''),
      make: m.make,
      model: m.model,
      year,
      type,
      depot,
      driver,
      status,
      odometer: Math.round(between(r, spec.odo[0], spec.odo[1]) * (1 - (year - 2016) / 14)),
      fuelLevel: status === 'offline' ? int(r, 8, 60) : int(r, 12, 97),
      tankGal: Math.round(between(r, spec.tank[0], spec.tank[1]) / 5) * 5,
      mpg,
      speed: status === 'moving' ? int(r, 24, 66) : 0,
      location: status === 'maintenance' ? `Service bay · ${depot}` : status === 'parked' && r() < 0.6 ? `Depot yard · ${depot}` : pick(r, ROADS[depot]),
      lastSeen: new Date(lastSeen).toISOString(),
      imei: '86' + Array.from({ length: 13 }, () => int(r, 0, 9)).join(''),
      fuelSensor: type !== 'Pickup' && r() < 0.9,
      alerts,
      health: status === 'maintenance' ? int(r, 38, 70) : int(r, 72, 99) - alerts * 4,
      nextServiceMi: int(r, -400, 14000),
      notes: '',
      createdAt: new Date(NOW - int(r, 60, 900) * DAY).toISOString(),
    })
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}
export const SEED_FLEET = makeFleet()

/* ---------- Daily operations metrics (180 days, to compare periods) ---------- */
export interface DayMetric {
  date: string
  miles: number
  gallons: number
  fuelCost: number
  idleHours: number
  onTime: number
  trips: number
  alerts: number
  byDepot: Record<string, number> // fuel cost
}
function makeDays(): DayMetric[] {
  const r = mulberry32(777)
  const out: DayMetric[] = []
  const start = new Date(NOW - 179 * DAY)
  start.setHours(0, 0, 0, 0)
  let price = 3.92
  const depotShare: Record<string, number> = { Tacoma: 0.33, Portland: 0.29, Spokane: 0.13, Boise: 0.1, Eugene: 0.15 }
  for (let i = 0; i < 180; i++) {
    const d = new Date(start.getTime() + i * DAY)
    const dow = d.getDay()
    const weekday = dow === 0 ? 0.42 : dow === 6 ? 0.6 : 1
    const season = 1 + 0.08 * Math.sin((i / 180) * Math.PI * 2 - 0.6) + i * 0.0006
    const miles = Math.round(15200 * weekday * season * between(r, 0.9, 1.1))
    price = Math.min(4.6, Math.max(3.6, price + between(r, -0.035, 0.037)))
    const mpg = between(r, 7.4, 8.2)
    const gallons = Math.round(miles / mpg)
    const fuelCost = Math.round(gallons * price)
    const byDepot: Record<string, number> = {}
    for (const dp of DEPOTS) byDepot[dp] = Math.round(fuelCost * depotShare[dp] * between(r, 0.88, 1.12))
    out.push({
      date: d.toISOString(),
      miles,
      gallons,
      fuelCost,
      idleHours: Math.round(weekday * between(r, 70, 118)),
      onTime: +Math.min(99.4, between(r, 90.5, 98.2) + (weekday < 1 ? 1 : 0)).toFixed(1),
      trips: Math.round(weekday * between(r, 170, 215)),
      alerts: Math.round(weekday * between(r, 6, 22)),
      byDepot,
    })
  }
  return out
}
export const DAYS = makeDays()

/* ---------- Fleet-wide alert feed ---------- */
export type AlertKind = 'fuel_drop' | 'overspeed' | 'harsh_brake' | 'geofence' | 'idle' | 'dtc' | 'offline' | 'low_fuel'
export interface FleetAlert {
  id: string
  vehicleId: string
  kind: AlertKind
  severity: 'critical' | 'warning' | 'info'
  at: string
  text: string
  acknowledged: boolean
}
export const ALERT_LABEL: Record<AlertKind, string> = {
  fuel_drop: 'Fuel drop', overspeed: 'Overspeed', harsh_brake: 'Harsh braking', geofence: 'Geofence',
  idle: 'Excess idle', dtc: 'Engine fault', offline: 'Tracker offline', low_fuel: 'Low fuel',
}
function makeAlerts(): FleetAlert[] {
  const r = mulberry32(4242)
  const out: FleetAlert[] = []
  const kinds: AlertKind[] = ['overspeed', 'overspeed', 'harsh_brake', 'harsh_brake', 'idle', 'idle', 'geofence', 'dtc', 'fuel_drop', 'low_fuel']
  for (let i = 0; i < 46; i++) {
    const v = pick(r, SEED_FLEET)
    const kind = v.status === 'offline' && r() < 0.6 ? 'offline' : pick(r, kinds)
    const at = NOW - Math.pow(r(), 1.6) * 6 * DAY
    let text = ''
    let severity: FleetAlert['severity'] = 'warning'
    switch (kind) {
      case 'fuel_drop': text = `Level fell ${int(r, 11, 38)} gal in ${int(r, 3, 9)} min while ignition off`; severity = 'critical'; break
      case 'overspeed': { const lim = pick(r, [55, 60, 65]); text = `${lim + int(r, 7, 16)} mph in a ${lim} mph zone for ${int(r, 40, 180)} s`; break }
      case 'harsh_brake': text = `−${between(r, 0.42, 0.71).toFixed(2)} g deceleration`; break
      case 'geofence': text = `Left ${pick(r, ['customer site', 'depot yard', 'approved corridor'])} outside schedule`; severity = 'info'; break
      case 'idle': text = `Idled ${int(r, 16, 58)} min with engine on`; severity = 'info'; break
      case 'dtc': text = `DTC ${pick(r, ['P0087', 'P2463', 'P0299', 'P20EE', 'P0401'])} · ${pick(r, ['fuel rail pressure low', 'DPF soot accumulation', 'turbo underboost', 'SCR efficiency', 'EGR flow insufficient'])}`; break
      case 'offline': text = `No GPS packet for ${int(r, 26, 90)} h · last ${v.location}`; severity = 'critical'; break
      case 'low_fuel': text = `Fuel at ${int(r, 6, 12)}% · nearest partner station ${between(r, 1.2, 9).toFixed(1)} mi`; break
    }
    out.push({ id: `AL-${9800 + i}`, vehicleId: v.id, kind, severity, at: new Date(at).toISOString(), text, acknowledged: at < NOW - 2 * DAY && r() < 0.7 })
  }
  return out.sort((a, b) => b.at.localeCompare(a.at))
}
export const ALERTS = makeAlerts()
