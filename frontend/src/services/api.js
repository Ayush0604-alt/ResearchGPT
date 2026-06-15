import axios from 'axios'
import { useAuthStore } from '../store/authStore'

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
})

// Attach JWT on every request
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Auto-logout on 401
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      useAuthStore.getState().logout()
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

// ── Auth ──────────────────────────────────────────────────────────────────────
export const authAPI = {
  register: (data) => api.post('/auth/register', data),
  login:    (data) => api.post('/auth/login', data),
  me:       ()     => api.get('/auth/me'),
}

// ── Projects ──────────────────────────────────────────────────────────────────
export const projectsAPI = {
  list:   ()     => api.get('/projects'),
  create: (data) => api.post('/projects', data),
  get:    (id)   => api.get(`/projects/${id}`),
  delete: (id)   => api.delete(`/projects/${id}`),
}

// ── Agents ────────────────────────────────────────────────────────────────────
export const agentsAPI = {
  run:    (data) => api.post('/agents/run', data),
  status: (id)   => api.get(`/agents/status/${id}`),
}

// ── Papers ────────────────────────────────────────────────────────────────────
export const papersAPI = {
  list:      (pid) => api.get(`/papers/${pid}`),
  summaries: (pid) => api.get(`/papers/${pid}/summaries`),
  findings:  (pid) => api.get(`/papers/${pid}/findings`),
}

// ── Reviews ───────────────────────────────────────────────────────────────────
export const reviewsAPI = {
  get:      (pid) => api.get(`/reviews/${pid}`),
  // FIX: use responseType: 'text' so axios doesn't parse the markdown as JSON
  markdown: (pid) => api.get(`/reviews/${pid}/markdown`, { responseType: 'text' }),
}

// ── Chat ──────────────────────────────────────────────────────────────────────
export const chatAPI = {
  history: (pid) => api.get(`/chat/history/${pid}`),
  clear:   (pid) => api.delete(`/chat/history/${pid}`),
  query:   (data) => api.post('/chat/query', data),
}

export default api