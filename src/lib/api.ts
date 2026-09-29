/** Tiny fetch wrapper for the Axlework Go API (JWT bearer auth, JSON errors, CSV downloads). */
import { useCallback, useEffect, useRef, useState } from 'react'

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '/api'
const TOKEN_KEY = 'axw.token'

export class ApiError extends Error {
  status: number
  code: string
  fields?: Record<string, string>
  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message)
    this.status = status
    this.code = code
    this.fields = fields
  }
}

let token: string | null = (() => { try { return localStorage.getItem(TOKEN_KEY) } catch { return null } })()
let onUnauthorized: (() => void) | null = null

export const getToken = () => token
export function setToken(t: string | null) {
  token = t
  try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY) } catch { /* private mode */ }
}
export function setUnauthorizedHandler(fn: (() => void) | null) { onUnauthorized = fn }

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ApiError(0, 'network', 'Can’t reach the Axlework API. Check your connection and try again.')
  }
  if (res.ok) return res
  let body: { error?: string; message?: string; fields?: Record<string, string> } = {}
  try { body = await res.json() } catch { /* non-JSON error */ }
  if (res.status === 401 && token && !path.startsWith('/auth/login')) onUnauthorized?.()
  throw new ApiError(res.status, body.error ?? 'http_error', body.message ?? `Request failed (${res.status})`, body.fields)
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const res = await request(path, { method: opts.method ?? 'GET', body: opts.body === undefined ? undefined : JSON.stringify(opts.body), signal: opts.signal })
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** Downloads a server-rendered file (e.g. CSV). Returns the row count the API reports. */
export async function download(path: string, fallbackName: string): Promise<number> {
  const res = await request(path)
  const blob = await res.blob()
  const name = /filename="?([^";]+)"?/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? fallbackName
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return Number(res.headers.get('X-Row-Count') ?? 0)
}

export const qs = (params: Record<string, string | number | null | undefined>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

/** GET hook: keeps the previous data while refetching, exposes loading/error and reload(). */
export function useApi<T>(path: string | null, delayMs = 0) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(path !== null)
  const [nonce, setNonce] = useState(0)
  const first = useRef(true)
  useEffect(() => {
    if (path === null) return
    const ctl = new AbortController()
    setLoading(true)
    const wait = first.current ? 0 : delayMs
    first.current = false
    const t = setTimeout(() => {
      api<T>(path, { signal: ctl.signal })
        .then((d) => { setData(d); setError(null) })
        .catch((e) => { if (e.name !== 'AbortError') setError(e instanceof ApiError ? e : new ApiError(0, 'unknown', String(e))) })
        .finally(() => { if (!ctl.signal.aborted) setLoading(false) })
    }, wait)
    return () => { clearTimeout(t); ctl.abort() }
  }, [path, nonce, delayMs])
  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { data, error, loading, reload, setData }
}
