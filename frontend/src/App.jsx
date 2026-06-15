import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore'

// Pages
import LoginPage         from './pages/LoginPage'
import RegisterPage      from './pages/RegisterPage'
import DashboardPage     from './pages/DashboardPage'
import NewProjectPage    from './pages/NewProjectPage'
import ProjectPage       from './pages/ProjectPage'
import ChatPage          from './pages/ChatPage'
import ReviewPage        from './pages/ReviewPage'


// Layout
import AppLayout from './components/layout/AppLayout'

function ProtectedRoute({ children }) {
  const token = useAuthStore(s => s.token)
  return token ? children : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login"    element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      {/* Protected — wrapped in layout */}
      <Route path="/" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
        <Route index                           element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard"                element={<DashboardPage />} />
        <Route path="project/new"              element={<NewProjectPage />} />
        <Route path="project/:id"              element={<ProjectPage />} />
        <Route path="project/:id/chat"         element={<ChatPage />} />
        <Route path="project/:id/review"       element={<ReviewPage />} />

      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
