import { useState, type ReactNode } from 'react'
import { useApp, type Settings as S } from '../store/app'
import { useTitle } from '../lib/useTitle'
import { ISun, IMoon } from '../components/Icons'

function Row({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <div className="grid gap-x-8 gap-y-2 border-b border-line px-5 py-4 last:border-0 md:grid-cols-[260px_1fr] sm:px-6">
      <div>
        <div className="text-[13px] font-semibold">{title}</div>
        {desc && <div className="mt-0.5 text-[12px] leading-relaxed text-ink-2">{desc}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  )
}
function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={`relative h-[22px] w-10 shrink-0 rounded-full border transition-colors ${on ? 'border-ink bg-ink' : 'border-line-strong bg-sunk'}`}>
      <span className={`absolute top-[2px] h-4 w-4 rounded-full transition-all ${on ? 'left-[20px] bg-signal' : 'left-[2px] bg-surface shadow ring-1 ring-line-strong'}`} />
    </button>
  )
}
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="label mb-2 px-1">{title}</h2>
      <div className="panel">{children}</div>
    </section>
  )
}

export default function Settings() {
  useTitle('Settings')
  const { settings, setSettings, theme, setTheme, resetDemo, toast } = useApp()
  const [s, setS] = useState<S>(settings)
  const [confirm, setConfirm] = useState(false)
  const up = <K extends keyof S>(k: K, v: S[K]) => setS((x) => ({ ...x, [k]: v }))
  const dirty = JSON.stringify(s) !== JSON.stringify(settings)
  const emailOk = /^\S+@\S+\.\S+$/.test(s.email)
  const numIn = (k: 'fuelPrice' | 'idleLimit' | 'speedLimit' | 'fuelDropGal', step: number, unit: string, min: number, max: number) => (
    <span className="flex items-center gap-2">
      <input type="number" step={step} min={min} max={max} className="input num w-28" value={s[k]} onChange={(e) => up(k, Number(e.target.value))} aria-label={k} />
      <span className="text-[12px] text-ink-3">{unit}</span>
    </span>
  )

  return (
    <div className="mx-auto max-w-[920px] pb-16">
      <h1 className="display text-[28px] leading-tight sm:text-[32px]">Settings</h1>
      <p className="mt-1 text-[13px] text-ink-2">Workspace preferences and alert rules. Stored in this browser.</p>

      <Group title="Profile">
        <Row title="Name"><input className="input max-w-sm" value={s.name} onChange={(e) => up('name', e.target.value)} aria-label="Name" /></Row>
        <Row title="Email" desc="Where alert emails and the daily digest go.">
          <div className="w-full max-w-sm">
            <input className="input" value={s.email} onChange={(e) => up('email', e.target.value)} aria-invalid={!emailOk || undefined} aria-label="Email" />
            {!emailOk && <p className="mt-1 text-[12px] text-crit">Enter a valid email address.</p>}
          </div>
        </Row>
      </Group>

      <Group title="Workspace">
        <Row title="Company name"><input className="input max-w-sm" value={s.company} onChange={(e) => up('company', e.target.value)} aria-label="Company" /></Row>
        <Row title="Time zone" desc="Used for shift boundaries and daily reports.">
          <select className="input max-w-sm" value={s.timezone} onChange={(e) => up('timezone', e.target.value)} aria-label="Time zone">
            {['America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'Asia/Jakarta', 'Europe/London'].map((z) => <option key={z}>{z}</option>)}
          </select>
        </Row>
        <Row title="Units" desc="Applies to distance, volume, speed and efficiency everywhere.">
          <div className="seg">
            <button type="button" aria-pressed={s.units === 'imperial'} onClick={() => up('units', 'imperial')}>mi · gal · mpg</button>
            <button type="button" aria-pressed={s.units === 'metric'} onClick={() => up('units', 'metric')}>km · L · L/100km</button>
          </div>
        </Row>
        <Row title="Diesel price" desc="Fallback when a fuel-card price isn’t available.">{numIn('fuelPrice', 0.01, 'USD / gal', 2, 8)}</Row>
      </Group>

      <Group title="Alert rules">
        <Row title="Excess idle" desc="Engine on, speed 0, longer than…">{numIn('idleLimit', 1, 'minutes', 3, 120)}</Row>
        <Row title="Overspeed" desc="Flag when above posted limit or this cap.">{numIn('speedLimit', 1, 'mph', 40, 85)}</Row>
        <Row title="Fuel drop" desc="Sudden decrease with ignition off — likely siphoning or leak.">{numIn('fuelDropGal', 1, 'gal within 10 min', 2, 60)}</Row>
      </Group>

      <Group title="Notifications">
        <Row title="Email alerts" desc="Critical and warning alerts, batched every 5 minutes."><Toggle label="Email alerts" on={s.notifyEmail} onChange={(v) => up('notifyEmail', v)} /></Row>
        <Row title="SMS for critical" desc="Fuel drops and trackers going offline."><Toggle label="SMS" on={s.notifySms} onChange={(v) => up('notifySms', v)} /></Row>
        <Row title="Daily digest" desc="06:00 summary of yesterday’s distance, fuel and exceptions."><Toggle label="Daily digest" on={s.dailyDigest} onChange={(v) => up('dailyDigest', v)} /></Row>
      </Group>

      <Group title="Appearance">
        <Row title="Theme" desc="Applies immediately.">
          <div className="seg">
            <button type="button" aria-pressed={theme === 'light'} onClick={() => setTheme('light')} className="inline-flex items-center gap-1.5"><ISun size={14} />Light</button>
            <button type="button" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')} className="inline-flex items-center gap-1.5"><IMoon size={14} />Dark</button>
          </div>
        </Row>
      </Group>

      <Group title="Demo data">
        <Row title="Reset workspace" desc="Restores the seeded fleet, clears acknowledged alerts and settings.">
          {confirm ? (
            <>
              <button className="btn bg-crit text-white hover:bg-crit/90" onClick={() => { resetDemo(); setS(settings); setConfirm(false); toast('Demo data restored'); setTimeout(() => location.reload(), 400) }}>Yes, reset everything</button>
              <button className="btn-quiet" onClick={() => setConfirm(false)}>Cancel</button>
            </>
          ) : <button className="btn-ghost" onClick={() => setConfirm(true)}>Reset demo data</button>}
        </Row>
      </Group>

      {dirty && <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-[920px] items-center justify-end gap-2 px-4 py-3">
          <span className="mr-auto text-[12.5px] text-ink-2">You have unsaved changes</span>
          <button className="btn-quiet" onClick={() => setS(settings)}>Discard</button>
          <button className="btn-primary" disabled={!emailOk} onClick={() => { setSettings(s); toast('Settings saved') }}>Save settings</button>
        </div>
      </div>}
    </div>
  )
}
