import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthInit } from './hooks/useAuth'
import { useAuthStore } from './store/authStore'
import { ToastContainer } from './components/ui/Toast'
import { LoginDrawer } from './components/auth/LoginDrawer'
import { ErrorBoundary } from './components/ui/ErrorBoundary'
import Welcome from './pages/Welcome'
import Dashboard from './pages/Dashboard'
import PlanTrip from './pages/PlanTrip'
import TripDetail from './pages/TripDetail'
import Preferences from './pages/Preferences'
import Profile from './pages/Profile'
import Places from './pages/Places'

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
        <Route path="/welcome" element={<ErrorBoundary><Welcome /></ErrorBoundary>} />
        <Route path="/" element={<ErrorBoundary><Dashboard /></ErrorBoundary>} />
        <Route path="/plan" element={<ErrorBoundary><PlanTrip /></ErrorBoundary>} />
        <Route path="/trip/:tripId" element={<ErrorBoundary><TripDetail /></ErrorBoundary>} />
        <Route path="/preferences" element={<ErrorBoundary><Preferences /></ErrorBoundary>} />
        <Route path="/profile" element={<ErrorBoundary><Profile /></ErrorBoundary>} />
        <Route path="/places" element={<ErrorBoundary><Places /></ErrorBoundary>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <LoginDrawer />
      <ToastContainer />
    </BrowserRouter>
  )
}
