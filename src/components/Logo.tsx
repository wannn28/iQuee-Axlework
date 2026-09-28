export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="5" fill="#181714" />
      <path d="M7 23 14.5 8h3L25 23h-3.6l-1.6-3.4h-7.6L10.6 23Z" fill="#F2BE22" />
      <rect x="12.6" y="15.6" width="6.8" height="2.4" fill="#181714" />
    </svg>
  )
}
export function Logo({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <Mark />
      {!collapsed && <span className="display text-[17px] leading-none">axlework</span>}
    </span>
  )
}
