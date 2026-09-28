import { Link } from 'react-router-dom'
import { useTitle } from '../lib/useTitle'
export default function NotFound() {
  useTitle('Not found')
  return (
    <div className="py-24 max-w-md">
      <div className="label">Error 404</div>
      <h1 className="display text-4xl mt-2">Off the map.</h1>
      <p className="mt-3 text-ink-2">That page or vehicle doesn’t exist in this demo fleet.</p>
      <Link to="/" className="btn-primary mt-6">Back to overview</Link>
    </div>
  )
}
