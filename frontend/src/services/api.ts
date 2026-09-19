import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { useAuthStore } from '../store/authStore'
import type {
  AnalysisIn,
  ChatExchangeIn,
  ChatHistory,
  LiteratureReview,
  Paper,
  PaperExtractionIn,
  PaperFindings,
  PaperForAnalysis,
  PaperSummary,
  Project,
  ProjectList,
  User,
} from './types'

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
    // Required by the API's CSRF check on state-changing requests.
    'X-Requested-With': 'XMLHttpRequest',
  },
})

// Sessions are httpOnly cookies. When the short-lived access cookie expires,
// renew it once with the refresh cookie and retry; concurrent 401s share one
// refresh. If that fails the session is over: sign out.
let refreshing: Promise<void> | null = null

function refreshSession(): Promise<void> {
  refreshing ??= api
    .post<User>('/auth/refresh')
    .then((res) => useAuthStore.getState().setUser(res.data))
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

const NO_REFRESH = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout']

api.interceptors.response.use(
  (res) => res,
  async (err: AxiosError) => {
    const config = err.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined
    if (err.response?.status !== 401 || !config || NO_REFRESH.includes(config.url ?? '')) {
      return Promise.reject(err)
    }
    if (!config._retried) {
      config._retried = true
      try {
        await refreshSession()
        return api(config)
      } catch {
        /* fall through to sign-out */
      }
    }
    useAuthStore.getState().logout()
    window.location.href = '/login'
    return Promise.reject(err)
  },
)

// ── Auth ──────────────────────────────────────────────────────────────────────
export const authAPI = {
  register: (data: { email: string; username: string; password: string }) =>
    api.post<User>('/auth/register', data),
  /** Sets the session cookies; returns the user. */
  login: (data: { email: string; password: string }) => api.post<User>('/auth/login', data),
  logout: () => api.post('/auth/logout'),
  me: () => api.get<User>('/auth/me'),
}

// ── Projects ──────────────────────────────────────────────────────────────────
export const projectsAPI = {
  list: () => api.get<ProjectList>('/projects'),
  create: (data: { topic: string; title?: string; description?: string }) =>
    api.post<Project>('/projects', data),
  get: (id: number | string) => api.get<Project>(`/projects/${id}`),
  delete: (id: number | string) => api.delete(`/projects/${id}`),
  /** Start the server job that searches for papers and reads their PDFs. */
  collect: (id: number | string, maxPapers = 10) =>
    api.post<Project>(`/projects/${id}/collect`, { max_papers: maxPapers }),
  saveExtraction: (id: number | string, paperId: number, data: PaperExtractionIn) =>
    api.put(`/projects/${id}/papers/${paperId}/extraction`, data),
  saveAnalysis: (id: number | string, data: AnalysisIn) =>
    api.put<Project>(`/projects/${id}/analysis`, data),
}

// ── Papers ────────────────────────────────────────────────────────────────────
export const papersAPI = {
  list: (pid: number | string) => api.get<Paper[]>(`/papers/${pid}`),
  texts: (pid: number | string) => api.get<PaperForAnalysis[]>(`/papers/${pid}/texts`),
  summaries: (pid: number | string) => api.get<PaperSummary[]>(`/papers/${pid}/summaries`),
  findings: (pid: number | string) => api.get<PaperFindings[]>(`/papers/${pid}/findings`),
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
  /** Store a question and the answer generated in the browser. */
  saveExchange: (pid: number | string, data: ChatExchangeIn) =>
    api.post<ChatHistory>(`/chat/${pid}/messages`, data),
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
