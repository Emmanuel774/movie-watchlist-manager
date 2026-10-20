import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext.jsx'
import { CollectionProvider } from './collections/CollectionContext.jsx'
import CollectionMergePrompt from './collections/CollectionMergePrompt.jsx'
import { useAuth } from './auth/useAuth.js'
import AuthPage from './auth/AuthPage.jsx'
import ChangePasswordPage from './auth/ChangePasswordPage.jsx'
import AdminDashboard from './admin/AdminDashboard.jsx'
import MovieHome from './MovieHome.jsx'
import './auth/auth.css'

function LoadingScreen() {
  return (
    <main className="auth-loading" aria-live="polite">
      <span className="noir-mark" aria-hidden="true">N</span>
      <p>Restoring your NOIR session…</p>
    </main>
  )
}

function ProtectedRoute({ children }) {
  const { user, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) return <LoadingScreen />
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return children
}

function PublicRoute({ children }) {
  const { user, isLoading } = useAuth()

  if (isLoading) return <LoadingScreen />
  return user ? <Navigate to="/" replace /> : children
}

function AdminRoute({ children }) {
  const { user, isLoading } = useAuth()

  if (isLoading) return <LoadingScreen />
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== 'admin') return <Navigate to="/" replace />
  return children
}

function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicRoute>
            <AuthPage mode="login" />
          </PublicRoute>
        }
      />
      <Route
        path="/register"
        element={
          <PublicRoute>
            <AuthPage mode="register" />
          </PublicRoute>
        }
      />
      <Route
        path="/change-password"
        element={
          <ProtectedRoute>
            <ChangePasswordPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin"
        element={
          <AdminRoute>
            <AdminDashboard />
          </AdminRoute>
        }
      />
      <Route
        path="/"
        element={<MovieHome />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <CollectionProvider>
          <AppRoutes />
          <CollectionMergePrompt />
        </CollectionProvider>
      </AuthProvider>
    </HashRouter>
  )
}
