import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { LayoutDashboard, Plus, LogOut, FlaskConical } from 'lucide-react'

export default function AppLayout() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col">
        {/* Brand */}
        <div className="h-14 flex items-center gap-2.5 px-5 border-b border-gray-100">
          <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
            <FlaskConical size={14} className="text-white" />
          </div>
          <span className="font-semibold text-gray-900 text-sm">ResearchGPT</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          <p className="px-2 mb-2 text-xs font-medium text-gray-400 uppercase tracking-wider">Menu</p>
          <NavLink
            to="/dashboard"
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors
               ${isActive
                 ? 'bg-blue-50 text-blue-700 font-medium'
                 : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`
            }
          >
            <LayoutDashboard size={15} />
            Dashboard
          </NavLink>
          <NavLink
            to="/project/new"
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors
               ${isActive
                 ? 'bg-blue-50 text-blue-700 font-medium'
                 : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`
            }
          >
            <Plus size={15} />
            New Project
          </NavLink>
        </nav>

        {/* User footer */}
        <div className="px-3 py-3 border-t border-gray-100">
          <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg mb-1">
            <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center
                            justify-center text-xs font-semibold flex-shrink-0">
              {(user?.username?.[0] || 'U').toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-900 truncate">{user?.username || 'User'}</p>
              <p className="text-xs text-gray-400 truncate">{user?.email || ''}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-500
                       hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-8 py-7">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
