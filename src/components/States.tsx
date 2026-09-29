import type { ApiError } from '../lib/api'

export function Spinner({ className = '' }: { className?: string }) {
  return <span className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-ink ${className}`} aria-hidden />
}

export function LoadingPanel({ label = 'Loading…', className = '' }: { label?: string; className?: string }) {
  return (
    <div className={`panel grid place-items-center px-4 py-20 text-[13px] text-ink-2 ${className}`} role="status" aria-live="polite">
      <span className="flex items-center gap-2.5"><Spinner />{label}</span>
    </div>
  )
}

export function ErrorPanel({ error, onRetry, className = '' }: { error: ApiError | Error; onRetry?: () => void; className?: string }) {
  return (
    <div className={`panel px-5 py-12 text-center ${className}`} role="alert">
      <div className="text-[14px] font-semibold text-crit">Couldn’t load this data</div>
      <p className="mx-auto mt-1 max-w-md text-[13px] text-ink-2">{error.message}</p>
      {onRetry && <button className="btn-ghost mt-4" onClick={onRetry}>Try again</button>}
    </div>
  )
}
