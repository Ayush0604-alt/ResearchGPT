import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FlaskConical, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { authAPI } from '../services/api'
import { useAuthStore } from '../store/authStore'

export default function RegisterPage() {
  const [form, setForm]       = useState({ email: '', username: '', password: '' })
  const [loading, setLoading] = useState(false)
  const { setAuth } = useAuthStore()
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (form.password.length < 8) {
      return toast.error('Password must be at least 8 characters')
    }
    setLoading(true)
    try {
      await authAPI.register(form)
      const { data } = await authAPI.login({ email: form.email, password: form.password })
      setAuth(data.access_token, { id: data.user_id, username: data.username, email: form.email })
      navigate('/dashboard')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">

        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-blue-600 mb-4">
            <FlaskConical size={22} className="text-white" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900">Create your account</h1>
          <p className="text-sm text-gray-500 mt-1">Start your AI research journey</p>
        </div>

        <div className="card-p">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Username</label>
              <input
                type="text"
                className="input"
                placeholder="johndoe"
                value={form.username}
                onChange={e => setForm({ ...form, username: e.target.value })}
                required
                autoFocus
              />
            </div>
            <div>
              <label className="label">Email address</label>
              <input
                type="email"
                className="input"
                placeholder="you@example.com"
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="label">Password</label>
              <input
                type="password"
                className="input"
                placeholder="Min. 8 characters"
                value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })}
                required
                minLength={8}
              />
            </div>
            <button
              type="submit"
              className="btn-primary w-full py-2.5 mt-1"
              disabled={loading}
            >
              {loading
                ? <><Loader2 size={15} className="animate-spin" /> Creating account…</>
                : 'Create account'
              }
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-gray-500 mt-5">
          Already have an account?{' '}
          <Link to="/login" className="text-blue-600 hover:text-blue-700 font-medium">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
