import { useMemo, useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useApp } from '../store/app'
import { Logo } from '../components/Logo'
import { RouteMap } from '../components/RouteMap'
import { SEED_FLEET } from '../data/fleet'
import { vehicleDetail } from '../data/detail'
import { useTitle } from '../lib/useTitle'
import { IFuel, IGauge } from '../components/Icons'

export default function Login() {
  useTitle('Sign in')
  const { authed, login } = useApp()
  const nav = useNavigate()
  const loc = useLocation()
  const from = (loc.state as { from?: string } | null)?.from ?? '/'
  const [email, setEmail] = useState('alex.moreno@harborpine.example')
  const [pw, setPw] = useState('demo-password')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<'' | 'demo' | 'form'>('')
  const hero = useMemo(() => {
    const v = SEED_FLEET.find((x) => x.status === 'moving' && x.type === 'Tractor') ?? SEED_FLEET[0]
    const dropUnit = SEED_FLEET.find((x) => x.type === 'Reefer' && x.fuelSensor)?.id ?? SEED_FLEET[1].id
    return { v, d: vehicleDetail(v), dropUnit }
  }, [])
  if (authed) return <Navigate to={from} replace />

  const go = async (kind: 'demo' | 'form') => {
    setBusy(kind); setErr('')
    try {
      await login(kind === 'demo' ? { demo: true } : { email, password: pw })
      nav(from, { replace: true })
    } catch (e) {
      setErr((e as Error).message)
      setBusy('')
    }
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!/^\S+@\S+\.\S+$/.test(email)) return setErr('Enter a valid email address.')
    if (!pw) return setErr('Enter your password.')
    go('form')
  }
  const enter = () => go('demo')

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(420px,5fr)_7fr]">
      <div className="flex flex-col px-6 py-6 sm:px-12 lg:px-14">
        <Logo />
        <div className="my-auto w-full max-w-sm py-12">
          <p className="label">Fleet & fuel operations</p>
          <h1 className="display mt-3 text-[34px] leading-[1.05]">Sign in to your yard.</h1>
          <p className="mt-3 text-[14px] leading-relaxed text-ink-2">This is a demo workspace for <b className="text-ink font-semibold">Harbor & Pine Freight</b>, a fictional 68-vehicle carrier in the Pacific Northwest. Sign in with the prefilled demo account (<span className="num text-[12.5px]">demo-password</span>) or jump straight in.</p>

          <button onClick={enter} disabled={!!busy} className="btn-signal mt-7 h-11 w-full text-[14px]">{busy === 'demo' ? 'Signing in…' : 'Enter demo — no account needed'}</button>
          <div className="my-6 flex items-center gap-3 text-[11px] text-ink-3"><span className="h-px flex-1 bg-line" />or sign in<span className="h-px flex-1 bg-line" /></div>

          <form onSubmit={submit} noValidate className="space-y-4">
            <label className="block">
              <span className="text-[12.5px] font-semibold">Work email</span>
              <input className="input mt-1.5 h-10" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setErr('') }} autoComplete="username" />
            </label>
            <label className="block">
              <span className="flex justify-between text-[12.5px] font-semibold">Password <span className="font-normal text-ink-3">SSO available on Fleet plan</span></span>
              <input className="input mt-1.5 h-10" type="password" value={pw} onChange={(e) => { setPw(e.target.value); setErr('') }} autoComplete="current-password" />
            </label>
            {err && <p className="text-[12.5px] text-crit" role="alert">{err}</p>}
            <button className="btn-primary h-10 w-full" disabled={!!busy}>{busy === 'form' ? 'Signing in…' : 'Sign in'}</button>
          </form>
        </div>
        <p className="text-[11.5px] text-ink-3">Portfolio demo by <a className="underline underline-offset-2" href="https://iquee.tech">iQuee</a> · seeded mock data served by a Go + PostgreSQL API, reset every 24 h.</p>
      </div>

      <div className="relative hidden overflow-hidden border-l border-line bg-sunk lg:flex lg:flex-col lg:justify-between p-12 xl:p-16">
        <div>
          <p className="display max-w-xl text-[52px] leading-[0.98] xl:text-[60px]">
            Every truck.<br />Every gallon.<br /><span className="bg-signal px-2 text-[#181714] box-decoration-clone">Accounted for.</span>
          </p>
          <p className="mt-6 max-w-md text-[15px] leading-relaxed text-ink-2">GPS trackers and tank-level sensors stream into one console: where each unit is, how it’s being driven, and where the fuel actually went.</p>
        </div>
        <div className="relative mt-10">
          <div className="overflow-hidden rounded-md border border-line-strong bg-surface shadow-[0_24px_60px_-30px_rgba(40,30,10,.45)]">
            <div className="flex items-center justify-between border-b border-line px-4 h-10 text-[12px]">
              <span className="font-semibold">{hero.v.id} · {hero.v.make} {hero.v.model}</span>
              <span className="num text-ink-3">{hero.v.location}</span>
            </div>
            <RouteMap route={hero.d.route} decor />
          </div>
          <div className="absolute -left-6 bottom-8 w-60 rounded-md border border-line-strong bg-surface p-3.5 shadow-lg">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-label text-crit"><IFuel size={14} /> Fuel drop</div>
            <div className="mt-1 text-[13px] font-semibold">−19 gal in 6 min, ignition off</div>
            <div className="num mt-0.5 text-[11px] text-ink-3">{hero.dropUnit} · Depot yard · 02:14</div>
          </div>
          <div className="absolute -right-5 bottom-16 rounded-md border border-line-strong bg-ink px-3.5 py-2.5 text-bg shadow-lg">
            <div className="flex items-center gap-2 text-[11px] text-bg/60"><IGauge size={14} /> Live speed</div>
            <div className="num text-[22px] font-semibold leading-tight">{hero.v.speed} <span className="text-[12px] text-bg/60">mph</span></div>
          </div>
        </div>
      </div>
    </div>
  )
}
