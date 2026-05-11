import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthInit } from './hooks/useAuth'
import { ToastContainer } from './components/ui/Toast'
import { LoginDrawer } from './components/auth/LoginDrawer'
import { ErrorBoundary } from './components/ui/ErrorBoundary'
import { ProtectedRoute } from './components/auth/ProtectedRoute'
import Home from './pages/Home'
import Welcome from './pages/Welcome'
import Dashboard from './pages/Dashboard'
import PlanDestinations from './pages/PlanDestinations'
import PlanRoute from './pages/PlanRoute'
import TripDetail from './pages/TripDetail'
import TripTracking from './pages/TripTracking'
import ReplanPage from './pages/ReplanPage'
import LandmarkPage from './pages/LandmarkPage'
import Preferences from './pages/Preferences'
import Profile from './pages/Profile'
import Places from './pages/Places'
import Events from './pages/Events'
import Destinations from './pages/Destinations'
import About from './pages/About'
import DevSimulation from './pages/DevSimulation'

function AuthInit() {
  useAuthInit()
  return null
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthInit />
      <Routes>
        {/* Public */}
        <Route path="/" element={<ErrorBoundary><Home /></ErrorBoundary>} />
        <Route path="/welcome" element={<ErrorBoundary><Welcome /></ErrorBoundary>} />
        <Route path="/landmark" element={<ErrorBoundary><LandmarkPage /></ErrorBoundary>} />
        <Route path="/events" element={<ErrorBoundary><Events /></ErrorBoundary>} />
        <Route path="/destinations" element={<ErrorBoundary><Destinations /></ErrorBoundary>} />
        <Route path="/about" element={<ErrorBoundary><About /></ErrorBoundary>} />

        {/* Protected */}
        <Route path="/trips" element={<ErrorBoundary><ProtectedRoute><Dashboard /></ProtectedRoute></ErrorBoundary>} />
        <Route path="/plan" element={<ErrorBoundary><ProtectedRoute><PlanDestinations /></ProtectedRoute></ErrorBoundary>} />
        <Route path="/plan/route" element={<ErrorBoundary><ProtectedRoute><PlanRoute /></ProtectedRoute></ErrorBoundary>} />
        <Route path="/trip/:tripId" element={<ErrorBoundary><ProtectedRoute><TripDetail /></ProtectedRoute></ErrorBoundary>} />
        <Route path="/trip/:tripId/live" element={<ErrorBoundary><ProtectedRoute><TripTracking /></ProtectedRoute></ErrorBoundary>} />
        <Route path="/trip/:tripId/replan" element={<ErrorBoundary><ProtectedRoute><ReplanPage /></ProtectedRoute></ErrorBoundary>} />
        <Route path="/preferences" element={<ErrorBoundary><ProtectedRoute><Preferences /></ProtectedRoute></ErrorBoundary>} />
        <Route path="/profile" element={<ErrorBoundary><ProtectedRoute><Profile /></ProtectedRoute></ErrorBoundary>} />
        <Route path="/places" element={<ErrorBoundary><ProtectedRoute><Places /></ProtectedRoute></ErrorBoundary>} />

        {/* Dev/PO demo tool — public, no auth */}
        <Route path="/dev/sim" element={<ErrorBoundary><DevSimulation /></ErrorBoundary>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <LoginDrawer />
      <ToastContainer />
    </BrowserRouter>
  )
}
