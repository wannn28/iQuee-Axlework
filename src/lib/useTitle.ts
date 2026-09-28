import { useEffect } from 'react'
export function useTitle(t: string) {
  useEffect(() => {
    document.title = t ? `${t} · Axlework` : 'Axlework — Fleet & fuel operations console (demo)'
  }, [t])
}
