import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useApp } from './store/app'
import { Layout } from './components/Layout'
import Login from './pages/Login'
import Overview from './pages/Overview'
import Vehicles from './pages/Vehicles'
import VehicleDetail from './pages/VehicleDetail'
import VehicleForm from './pages/VehicleForm'
import Settings from './pages/Settings'
import NotFound from './pages/NotFound'

function Guard({ children }: { children: JSX.Element }) {
  const { authed } = useApp()
  const loc = useLocation()
  return authed ? children : <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Guard><Layout /></Guard>}>
        <Route index element={<Overview />} />
        <Route path="vehicles" element={<Vehicles />} />
        <Route path="vehicles/new" element={<VehicleForm />} />
        <Route path="vehicles/:id" element={<VehicleDetail />} />
        <Route path="vehicles/:id/edit" element={<VehicleForm />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
