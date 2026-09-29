import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useApp } from '../store/app'
import { DEPOTS, DRIVERS, TYPES, type Vehicle, type VehicleType } from '../data/fleet'
import { api, useApi, type ApiError } from '../lib/api'
import { ErrorPanel, LoadingPanel } from '../components/States'
import { useTitle } from '../lib/useTitle'
import { IArrowLeft, IAlert } from '../components/Icons'
import NotFound from './NotFound'

interface FormState {
  id: string; plate: string; vin: string; make: string; model: string; year: string; type: VehicleType | ''
  depot: string; driver: string; tankGal: string; imei: string; fuelSensor: boolean; notes: string
}
type Errors = Partial<Record<keyof FormState, string>>
const LABELS: Record<keyof FormState, string> = {
  id: 'Unit number', plate: 'License plate', vin: 'VIN', make: 'Make', model: 'Model', year: 'Model year', type: 'Vehicle type',
  depot: 'Home depot', driver: 'Assigned driver', tankGal: 'Tank capacity', imei: 'GPS tracker IMEI', fuelSensor: 'Fuel sensor', notes: 'Notes',
}

function validate(f: FormState): Errors {
  const e: Errors = {}
  const id = f.id.trim().toUpperCase()
  if (!id) e.id = 'Required.'
  else if (!/^[A-Z]{2}-\d{3,4}$/.test(id)) e.id = 'Use the format HP-1234 (2 letters, dash, 3–4 digits).'
  if (!f.plate.trim()) e.plate = 'Required.'
  else if (f.plate.trim().length < 4 || f.plate.trim().length > 10) e.plate = 'Plates are 4–10 characters.'
  const vin = f.vin.trim().toUpperCase()
  if (!vin) e.vin = 'Required.'
  else if (vin.length !== 17) e.vin = `VINs are exactly 17 characters (currently ${vin.length}).`
  else if (/[IOQ]/.test(vin)) e.vin = 'VINs never contain the letters I, O or Q.'
  else if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) e.vin = 'Letters and digits only.'
  if (!f.make.trim()) e.make = 'Required.'
  if (!f.model.trim()) e.model = 'Required.'
  const y = Number(f.year)
  if (!f.year) e.year = 'Required.'
  else if (!Number.isInteger(y) || y < 1995 || y > 2027) e.year = 'Between 1995 and 2027.'
  if (!f.type) e.type = 'Choose a type.'
  if (!f.depot) e.depot = 'Choose a depot.'
  const t = Number(f.tankGal)
  if (!f.tankGal) e.tankGal = 'Required.'
  else if (!(t >= 10 && t <= 400)) e.tankGal = 'Between 10 and 400 gal.'
  if (!f.imei.trim()) e.imei = 'Required to receive GPS data.'
  else if (!/^\d{15}$/.test(f.imei.trim())) e.imei = 'IMEI is 15 digits (found on the tracker label).'
  if (f.notes.length > 280) e.notes = `Max 280 characters (${f.notes.length}).`
  return e
}

function Field({ name, label, hint, error, children, className = '' }: { name: string; label: string; hint?: string; error?: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={name} className="block text-[12.5px] font-semibold">{label}</label>
      <div className="mt-1.5">{children}</div>
      {error ? <p id={`${name}-err`} className="mt-1 text-[12px] text-crit">{error}</p> : hint ? <p className="mt-1 text-[12px] text-ink-3">{hint}</p> : null}
    </div>
  )
}
function Section({ title, desc, children }: { title: string; desc: string; children: ReactNode }) {
  return (
    <section className="grid gap-x-10 gap-y-4 border-b border-line py-7 last:border-0 md:grid-cols-[240px_1fr]">
      <div>
        <h2 className="text-[15px] font-bold">{title}</h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{desc}</p>
      </div>
      <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">{children}</div>
    </section>
  )
}

interface DriverRow { id: number; name: string; vehicleId: string | null }
const EMPTY: FormState = { id: '', plate: '', vin: '', make: '', model: '', year: '', type: '', depot: '', driver: '', tankGal: '', imei: '', fuelSensor: true, notes: '' }
const toForm = (v: Vehicle): FormState => ({
  id: v.id, plate: v.plate, vin: v.vin, make: v.make, model: v.model, year: String(v.year), type: v.type,
  depot: v.depot, driver: v.driver ?? '', tankGal: String(v.tankGal), imei: v.imei, fuelSensor: v.fuelSensor, notes: v.notes,
})

export default function VehicleForm() {
  const { id } = useParams()
  const existing = useApi<Vehicle>(id ? `/vehicles/${encodeURIComponent(id)}` : null)
  const drivers = useApi<DriverRow[]>('/drivers')
  useTitle(id ? `Edit ${id}` : 'Add vehicle')
  if (id && existing.error?.status === 404) return <NotFound />
  if (id && !existing.data) return existing.error ? <ErrorPanel className="mx-auto max-w-[1000px]" error={existing.error} onRetry={existing.reload} /> : <LoadingPanel className="mx-auto max-w-[1000px]" label="Loading vehicle…" />
  return <VehicleFormInner key={id ?? 'new'} editing={existing.data ?? undefined} drivers={drivers.data ?? []} />
}

function VehicleFormInner({ editing, drivers }: { editing?: Vehicle; drivers: DriverRow[] }) {
  const { toast, refreshSummary } = useApp()
  const nav = useNavigate()
  const initial = useMemo<FormState>(() => (editing ? toForm(editing) : EMPTY), [editing])
  const [f, setF] = useState<FormState>(initial)
  const [touched, setTouched] = useState<Partial<Record<keyof FormState, boolean>>>({})
  const [submitted, setSubmitted] = useState(false)
  const [serverErrors, setServerErrors] = useState<Errors>({})
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const errors: Errors = { ...serverErrors, ...validate(f) }
  const show = (k: keyof FormState) => (touched[k] || submitted ? errors[k] : undefined)
  const errorList = Object.entries(errors) as [keyof FormState, string][]
  const busyDrivers = new Set(drivers.filter((d) => d.vehicleId && d.vehicleId !== editing?.id).map((d) => d.name))
  const driverNames = drivers.length ? drivers.map((d) => d.name) : DRIVERS
  const dirty = JSON.stringify(f) !== JSON.stringify(initial)
  const edit = (k: keyof FormState, value: string | boolean) => {
    setF((s) => ({ ...s, [k]: value }))
    if (serverErrors[k]) setServerErrors((e) => { const n = { ...e }; delete n[k]; return n })
  }

  const bind = (k: keyof FormState) => ({
    id: k, name: k, value: f[k] as string,
    onChange: (e: { target: { value: string } }) => edit(k, e.target.value),
    onBlur: () => setTouched((t) => ({ ...t, [k]: true })),
    'aria-invalid': show(k) ? true : undefined,
    'aria-describedby': show(k) ? `${k}-err` : undefined,
  })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    setFormError('')
    if (errorList.length) {
      document.getElementById('form-errors')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    const body = {
      id: f.id.trim().toUpperCase(), plate: f.plate.trim().toUpperCase(), vin: f.vin.trim().toUpperCase(), make: f.make.trim(), model: f.model.trim(),
      year: Number(f.year), type: f.type, depot: f.depot, driver: f.driver || null, tankGal: Number(f.tankGal), imei: f.imei.trim(),
      fuelSensor: f.fuelSensor, notes: f.notes.trim(),
    }
    setSaving(true)
    try {
      const v = editing
        ? await api<Vehicle>(`/vehicles/${encodeURIComponent(editing.id)}`, { method: 'PUT', body })
        : await api<Vehicle>('/vehicles', { method: 'POST', body })
      refreshSummary()
      toast(editing ? `${v.id} updated` : `${v.id} added to the fleet`)
      nav(`/vehicles/${v.id}`)
    } catch (err) {
      const ae = err as ApiError
      if (ae.fields && Object.keys(ae.fields).length) {
        setServerErrors(ae.fields as Errors)
        setTimeout(() => document.getElementById('form-errors')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0)
      } else setFormError(ae.message)
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-[1000px]">
      <Link to={editing ? `/vehicles/${editing.id}` : '/vehicles'} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-2 hover:text-ink"><IArrowLeft size={15} /> {editing ? editing.id : 'Vehicles'}</Link>
      <h1 className="display mt-3 text-[28px] leading-tight sm:text-[32px]">{editing ? `Edit ${editing.id}` : 'Add a vehicle'}</h1>
      <p className="mt-1 text-[13px] text-ink-2">{editing ? 'Changes are saved to the fleet database.' : 'Register a unit and pair its GPS tracker. It will appear as parked at its home depot until the first packet arrives.'}</p>

      {formError && <div role="alert" className="mt-5 rounded-md border border-crit/40 bg-crit/5 p-4 text-[13px] font-semibold text-crit">{formError}</div>}
      {submitted && errorList.length > 0 && (
        <div id="form-errors" role="alert" className="mt-5 rounded-md border border-crit/40 bg-crit/5 p-4">
          <div className="flex items-center gap-2 text-[13px] font-bold text-crit"><IAlert size={16} /> {errorList.length} field{errorList.length > 1 ? 's' : ''} need attention</div>
          <ul className="mt-2 grid gap-x-6 gap-y-0.5 text-[12.5px] sm:grid-cols-2">
            {errorList.map(([k, msg]) => (
              <li key={k}><button type="button" className="text-left underline decoration-crit/40 underline-offset-2 hover:decoration-crit" onClick={() => document.getElementById(k)?.focus()}><b>{LABELS[k]}</b> — {msg}</button></li>
            ))}
          </ul>
        </div>
      )}

      <form onSubmit={submit} noValidate className="panel mt-5 px-5 sm:px-7">
        <div>
        <Section title="Identity" desc="How the unit shows up in reports, invoices and DOT paperwork.">
          <Field name="id" label="Unit number" hint="Your internal fleet number, e.g. HP-1250" error={show('id')}>
            <input className="input num uppercase" placeholder="HP-1250" {...bind('id')} disabled={!!editing} />
          </Field>
          <Field name="plate" label="License plate" error={show('plate')}><input className="input num uppercase" placeholder="WA C48213" {...bind('plate')} /></Field>
          <Field name="vin" label="VIN" hint="17 characters, on the driver-side door pillar" error={show('vin')} className="sm:col-span-2">
            <div className="relative">
              <input className="input num pr-14 uppercase tracking-wider" maxLength={17} placeholder="1XKYD49X0NJ123456" {...bind('vin')} />
              <span className={`num pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] ${f.vin.length === 17 ? 'text-ok' : 'text-ink-3'}`}>{f.vin.length}/17</span>
            </div>
          </Field>
          <Field name="make" label="Make" error={show('make')}><input className="input" placeholder="Kenworth" list="makes" {...bind('make')} /></Field>
          <datalist id="makes">{['Freightliner', 'Kenworth', 'Peterbilt', 'Volvo', 'International', 'Isuzu', 'Hino', 'Ford', 'Mercedes-Benz', 'Ram', 'Chevrolet'].map((m) => <option key={m} value={m} />)}</datalist>
          <Field name="model" label="Model" error={show('model')}><input className="input" placeholder="T680" {...bind('model')} /></Field>
          <Field name="year" label="Model year" error={show('year')}><input className="input num" inputMode="numeric" placeholder="2024" {...bind('year')} /></Field>
          <Field name="type" label="Vehicle type" error={show('type')}>
            <select className="input" {...bind('type')}>
              <option value="">Select…</option>
              {TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
        </Section>

        <Section title="Assignment" desc="Depot and driver drive the default geofence, dispatch board and fuel-card rules.">
          <Field name="depot" label="Home depot" error={show('depot')}>
            <select className="input" {...bind('depot')}>
              <option value="">Select…</option>
              {DEPOTS.map((d) => <option key={d}>{d}</option>)}
            </select>
          </Field>
          <Field name="driver" label="Assigned driver" hint="Optional. Drivers already on a unit are marked." error={show('driver')}>
            <select className="input" {...bind('driver')}>
              <option value="">Unassigned</option>
              {driverNames.map((d) => <option key={d} value={d}>{d}{busyDrivers.has(d) ? ' · on another unit' : ''}</option>)}
            </select>
          </Field>
        </Section>

        <Section title="Telematics" desc="Pair the GPS tracker and tank sensor so positions, trips and fuel events start streaming.">
          <Field name="imei" label="GPS tracker IMEI" hint="15 digits, printed under the barcode" error={show('imei')}><input className="input num" inputMode="numeric" maxLength={15} placeholder="861234567890123" {...bind('imei')} /></Field>
          <Field name="tankGal" label="Tank capacity (gal)" hint="Combined, for dual-tank tractors" error={show('tankGal')}><input className="input num" inputMode="decimal" placeholder="150" {...bind('tankGal')} /></Field>
          <div className="sm:col-span-2">
            <label className="flex cursor-pointer items-start gap-3 rounded-[5px] border border-line p-3 hover:bg-sunk/60">
              <input type="checkbox" className="check mt-0.5" checked={f.fuelSensor} onChange={(e) => edit('fuelSensor', e.target.checked)} />
              <span>
                <span className="block text-[13px] font-semibold">Capacitive fuel-level sensor installed</span>
                <span className="block text-[12px] text-ink-2">Enables tank-level charts, refuel reconciliation and sudden-drop (siphoning) alerts.</span>
              </span>
            </label>
          </div>
          <Field name="notes" label="Notes" error={show('notes')} className="sm:col-span-2">
            <textarea className="input h-24 resize-y py-2" placeholder="Anything dispatch should know — e.g. liftgate, reefer unit model, restricted routes." value={f.notes} onChange={(e) => edit('notes', e.target.value)} onBlur={() => setTouched((t) => ({ ...t, notes: true }))} id="notes" aria-invalid={show('notes') ? true : undefined} />
            <div className={`num mt-1 text-right text-[11px] ${f.notes.length > 280 ? 'text-crit' : 'text-ink-3'}`}>{f.notes.length}/280</div>
          </Field>
        </Section>

        </div>
        <div className="sticky bottom-0 -mx-5 flex items-center justify-end gap-2 rounded-b-md border-t border-line bg-surface/95 px-5 py-3 backdrop-blur sm:-mx-7 sm:px-7">
          <span className="mr-auto text-[12px] text-ink-3">{dirty ? 'Unsaved changes' : editing ? 'No changes' : ''}</span>
          <Link to={editing ? `/vehicles/${editing.id}` : '/vehicles'} className="btn-quiet">Cancel</Link>
          <button className="btn-primary" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Add vehicle'}</button>
        </div>
      </form>
    </div>
  )
}
