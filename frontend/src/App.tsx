import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useAuthInit } from './hooks/useAuth'
import { useAuthStore } from './store/authStore'
import { ToastContainer } from './components/ui/Toast'
import { LoginDrawer } from './components/auth/LoginDrawer'
import Welcome from './pages/Welcome'
import Dashboard from './pages/Dashboard'
import PlanTrip from './pages/PlanTrip'
import TripDetail from './pages/TripDetail'
import Preferences from './pages/Preferences'
import Profile from './pages/Profile'

function AuthInit() {
  useAuthInit()
  return null
}

function FirstVisitGuard() {
  const { user } = useAuthStore()
  const visited = localStorage.getItem('ts_visited')

  if (!visited) {
    localStorage.setItem('ts_visited', '1')
    return <Navigate to="/welcome" replace />
  }
  return <Navigate to="/" replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthInit />
      <Routes>
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/" element={<Dashboard />} />
        <Route path="/plan" element={<PlanTrip />} />
        <Route path="/trip/:tripId" element={<TripDetail />} />
        <Route path="/preferences" element={<Preferences />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <LoginDrawer />
      <ToastContainer />
    </BrowserRouter>
  )
}
