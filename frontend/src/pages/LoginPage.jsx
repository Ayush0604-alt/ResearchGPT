import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FlaskConical, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { authAPI } from '../services/api'
import { useAuthStore } from '../store/authStore'

export default function LoginPage() {
  const [form, setForm]     = useState({ email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const { setAuth } = useAuthStore()
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      const { data } = await authAPI.login(form)
      setAuth(data.access_token, { id: data.user_id, username: data.username, email: form.email })
      navigate('/dashboard')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Invalid email or password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">

        {/* Brand mark */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl
                          bg-brand-600 mb-4">
            <FlaskConical size={22} className="text-white" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900">Sign in to ResearchGPT</h1>
          <p className="text-sm text-gray-500 mt-1">AI-powered research assistant</p>
        </div>

        {/* Form card */}
        <div className="card-p">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Email address</label>
              <input
                type="email"
                className="input"
                placeholder="you@example.com"
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                required
                autoFocus
              />
            </div>
            <div>
              <label className="label">Password</label>
              <input
                type="password"
                className="input"
                placeholder="••••••••"
                value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })}
                required
              />
            </div>
            <button
              type="submit"
              className="btn-primary w-full py-2.5 mt-1"
              disabled={loading}
            >
              {loading
                ? <><Loader2 size={15} className="animate-spin" /> Signing in…</>
                : 'Sign in'
              }
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-gray-500 mt-5">
          Don't have an account?{' '}
          <Link to="/register" className="text-brand-600 hover:text-brand-700 font-medium">
            Create one
          </Link>
        </p>
      </div>
    </div>
  )
}
