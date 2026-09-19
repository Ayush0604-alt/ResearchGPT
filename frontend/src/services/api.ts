import axios, { type AxiosError } from 'axios'
import { useAuthStore } from '../store/authStore'
import type {
  ChatAnswer,
  ChatHistory,
  LiteratureReview,
  Paper,
  Project,
  ProjectList,
  TaskStatus,
  TokenResponse,
  User,
} from './types'

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
  (err: AxiosError) => {
    if (err.response?.status === 401) {
      useAuthStore.getState().logout()
      window.location.href = '/login'
    }
    return Promise.reject(err)
  },
)

// ── Auth ──────────────────────────────────────────────────────────────────────
export const authAPI = {
  register: (data: { email: string; username: string; password: string }) =>
    api.post<User>('/auth/register', data),
  login: (data: { email: string; password: string }) =>
    api.post<TokenResponse>('/auth/login', data),
  me: () => api.get<User>('/auth/me'),
}

// ── Projects ──────────────────────────────────────────────────────────────────
export const projectsAPI = {
  list: () => api.get<ProjectList>('/projects'),
  create: (data: { topic: string; title?: string; description?: string }) =>
    api.post<Project>('/projects', data),
  get: (id: number | string) => api.get<Project>(`/projects/${id}`),
  delete: (id: number | string) => api.delete(`/projects/${id}`),
}

// ── Agents ────────────────────────────────────────────────────────────────────
export const agentsAPI = {
  run: (data: { project_id: number; max_papers?: number }) =>
    api.post<TaskStatus>('/agents/run', data),
  status: (taskId: string) => api.get<TaskStatus>(`/agents/status/${taskId}`),
}

// ── Papers ────────────────────────────────────────────────────────────────────
export const papersAPI = {
  list: (pid: number | string) => api.get<Paper[]>(`/papers/${pid}`),
}

// ── Reviews ───────────────────────────────────────────────────────────────────
export const reviewsAPI = {
  get: (pid: number | string) => api.get<LiteratureReview>(`/reviews/${pid}`),
  // responseType 'text' so axios doesn't try to parse the markdown as JSON
  markdown: (pid: number | string) =>
    api.get<string>(`/reviews/${pid}/markdown`, { responseType: 'text' }),
}

// ── Chat ──────────────────────────────────────────────────────────────────────
export const chatAPI = {
  history: (pid: number | string) => api.get<ChatHistory>(`/chat/history/${pid}`),
  clear: (pid: number | string) => api.delete(`/chat/history/${pid}`),
  query: (data: { project_id: number; question: string }) =>
    api.post<ChatAnswer>('/chat/query', data),
}

interface ValidationIssue {
  loc?: (string | number)[]
  msg?: string
}

/** HTTP status of an axios error, if there was a response. */
export function httpStatus(err: unknown): number | undefined {
  return (err as AxiosError | undefined)?.response?.status
}

/**
 * Turn an axios error into a message for a toast.
 * FastAPI sends `detail` as a string (HTTPException) or, for 422 validation
 * errors, as a list of {loc, msg} objects.
 */
export function errorMessage(err: unknown, fallback = 'Something went wrong'): string {
  const detail = (err as AxiosError<{ detail?: unknown }> | undefined)?.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail) && detail.length) {
    return (detail as ValidationIssue[])
      .map((d) => {
        const field = d.loc?.[d.loc.length - 1]
        const msg = (d.msg || '').replace(/^Value error, /, '')
        return field && field !== 'body' ? `${field}: ${msg}` : msg
      })
      .join('; ')
  }
  return fallback
}

export default api
