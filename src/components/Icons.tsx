import type { ReactNode, SVGProps } from 'react'
type P = SVGProps<SVGSVGElement> & { size?: number }
const base = ({ size = 18, ...p }: P) => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, ...p,
})
const mk = (d: ReactNode) => (p: P) => <svg {...base(p)}>{d}</svg>

export const IOverview = mk(<><path d="M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z" /></>)
export const ITruck = mk(<><path d="M2 6h11v10H2zM13 9h4.5L21 12.5V16h-8" /><circle cx="6" cy="17.5" r="1.8" /><circle cx="17" cy="17.5" r="1.8" /></>)
export const IPlus = mk(<path d="M12 5v14M5 12h14" />)
export const ISettings = mk(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>)
export const IBell = mk(<><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" /></>)
export const ISearch = mk(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>)
export const ISun = mk(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>)
export const IMoon = mk(<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />)
export const IMenu = mk(<path d="M4 7h16M4 12h16M4 17h16" />)
export const ICollapse = mk(<><path d="M4 4v16M20 12H9M13 8l-4 4 4 4" /></>)
export const IExpand = mk(<><path d="M4 4v16M9 12h11M16 8l4 4-4 4" /></>)
export const IDownload = mk(<><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></>)
export const ILogout = mk(<><path d="M15 4h4v16h-4M10 16l4-4-4-4M14 12H3" /></>)
export const IX = mk(<path d="M6 6l12 12M18 6 6 18" />)
export const IChevron = mk(<path d="m9 6 6 6-6 6" />)
export const IChevronLeft = mk(<path d="m15 6-6 6 6 6" />)
export const ISort = mk(<path d="M8 9l4-4 4 4M8 15l4 4 4-4" />)
export const IUp = mk(<path d="M8 14l4-4 4 4" />)
export const IDown = mk(<path d="M8 10l4 4 4-4" />)
export const IPin = mk(<><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></>)
export const IFuel = mk(<><path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M4 10h10M14 8l3 3v6.5a1.5 1.5 0 0 0 3 0V9l-3-3" /></>)
export const IAlert = mk(<><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01" /></>)
export const ICheck = mk(<path d="M5 12.5l4.5 4.5L19 7.5" />)
export const IEdit = mk(<><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" /></>)
export const ITrash = mk(<><path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3" /></>)
export const IArrowLeft = mk(<path d="M19 12H5M11 6l-6 6 6 6" />)
export const IGauge = mk(<><path d="M12 14l4-5M3.5 18a9.5 9.5 0 1 1 17 0" /></>)
export const IClock = mk(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>)
export const ISignal = mk(<><path d="M5 18v-3M10 18v-6M15 18V9M20 18V5" /></>)
