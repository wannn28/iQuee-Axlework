/**
 * Exports the deterministic demo dataset (the same generator the frontend used to run in the browser)
 * to server/internal/seed/seed.json. The Go API embeds this file and loads it into PostgreSQL.
 *   npm run seed:export   (run from the project root)
 * Timestamps are written relative to `anchor`; the API re-anchors them to "now" when seeding.
 */
import { writeFileSync } from 'node:fs'
import { SEED_FLEET, DAYS, ALERTS, DRIVERS, DEPOTS, NOW } from '../src/data/fleet'
import { vehicleDetail } from '../src/data/detail'

const STATE: Record<string, string> = { Tacoma: 'WA', Portland: 'OR', Spokane: 'WA', Boise: 'ID', Eugene: 'OR' }
const pad = (n: number) => String(n).padStart(2, '0')
const localDate = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }

const out = {
  anchor: new Date(NOW).toISOString(),
  depots: DEPOTS.map((name) => ({ name, state: STATE[name] })),
  drivers: DRIVERS,
  vehicles: SEED_FLEET,
  days: DAYS.map((d) => ({ ...d, date: localDate(d.date) })),
  alerts: ALERTS,
  details: SEED_FLEET.map((v) => {
    const d = vehicleDetail(v)
    return {
      vehicleId: v.id,
      route: d.route,
      fuel: d.fuel,
      // fuel-drop events are NOT exported: the API detects them from the readings with SQL window functions
      timeline: d.timeline.filter((t) => t.kind !== 'drop'),
      services: d.services,
      today: d.today,
      progress: d.progress,
      active: d.active,
    }
  }),
}
writeFileSync('server/internal/seed/seed.json', JSON.stringify(out))
console.log(`seed.json: ${out.vehicles.length} vehicles, ${out.days.length} days, ${out.alerts.length} alerts, ${out.details.length} details`)
